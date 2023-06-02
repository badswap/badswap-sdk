import { protocol } from "./protocol";
import { BadP2P } from "./p2p";
import { BigNumberish, ethers } from "ethers";
import { pipe } from "it-pipe";
import * as lp from "it-length-prefixed";
import { sync as randomBytes } from "random-bytes";
import {
  TPCEcdsaKeyGen as TPC,
  TPCEcdsaSign as TPCsign,
} from "@safeheron/two-party-ecdsa-js";
import { EventEmitter } from "events";
import { SignatureTransfer, PERMIT2_ADDRESS } from "@uniswap/permit2-sdk";
import pushable from "it-pushable";
import { uniq, mapValues } from "lodash";
import { toBigInt, toWETH } from "./trade";
import BN from "bn.js";
import {
  keyshareToAddress,
  createContract,
  leftZeroPad,
  hashOffer,
  coerceToWeth,
  genericAbi,
  defer,
  isERC20Transfer,
  isERC721Transfer,
  isERC1155Transfer,
} from "./trade";
import PeerId from "peer-id";
import { createLogger } from "./logger";
import * as permit from "@pintswap/sdk/lib/permit";
import * as erc721Permit from "@pintswap/sdk/lib/erc721-permit";
import { detectPermit } from "@pintswap/sdk/lib/detect-permit";
import { detectERC721Permit } from "@pintswap/sdk/lib/detect-erc721-permit";
import fetch from "cross-fetch";

const { getAddress, getCreateAddress, Contract, Transaction } = ethers;

const logger = createLogger("badswap");

const toTypedTransfer = (transfer) =>
  Object.fromEntries([
    [
      isERC20Transfer(transfer)
        ? "erc20"
        : isERC721Transfer(transfer)
        ? "erc721"
        : isERC721Transfer(transfer)
        ? "erc1155"
        : (() => {
            throw Error("no token type found");
          })(),
      transfer,
    ],
  ]);

export const protobufOffersToHex = (offers) =>
  offers.map((v) => {
    return mapValues(v, (v) => {
      const transfer = v[v.data];
      const o: any = {};
      if (["erc20", "erc1155"].includes(v.data))
        o.amount = ethers.hexlify(ethers.decodeBase64(transfer.amount));
      if (["erc721", "erc1155"].includes(v.data))
        o.tokenId = ethers.hexlify(ethers.decodeBase64(transfer.tokenId));
      o.token = ethers.getAddress(
        ethers.zeroPadValue(ethers.decodeBase64(transfer.token), 20)
      );
      return o;
    });
  });

const getGasPrice = async (provider) => {
  if (provider.getGasPrice) return await provider.getGasPrice();
  return (await provider.getFeeData()).gasPrice;
};

const signTypedData = async (signer, ...args) => {
  if (signer.signTypedData) return await signer.signTypedData(...args);
  return await signer._signTypedData(...args);
};

let id = 0;
export async function sendFlashbotsTransaction(data) {
  const response = await fetch("https://rpc.flashbots.net", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      id: id++,
      jsonrpc: "2.0",
      method: "eth_sendRawTransaction",
      params: [data],
    }),
  });
  return await response.json();
}

const getPermitData = (signatureTransfer) => {
  const { domain, types, values } = SignatureTransfer.getPermitData(
    signatureTransfer.permit,
    signatureTransfer.permit2Address,
    signatureTransfer.chainId
  );
  return [domain, types, values];
};

export class BadswapTrade extends EventEmitter {
  public hashes: null | string[];
  public _deferred: ReturnType<typeof defer>;
  constructor() {
    super();
    this._deferred = defer();
    this.hashes = null;
  }
  async toPromise() {
    return await this._deferred.promise;
  }
  resolve(v?: any) {
    this.emit("complete", v);
    this._deferred.resolve(v);
  }
  reject(err) {
    this.emit("error", err);
    this._deferred.reject(err);
  }
}

export function encodeBatchFill(o) {
  return protocol.BatchFill.encode({
    fills: o.map((v) => ({
      offerHash: Buffer.from(ethers.toBeArray(v.offerHash)),
      amount: Buffer.from(ethers.toBeArray(ethers.getUint(v.amount))),
    })),
  }).finish();
}

export function decodeBatchFill(data) {
  const { fills } = protocol.BatchFill.toObject(
    protocol.BatchFill.decode(data),
    {
      enums: String,
      longs: String,
      bytes: String,
      defaults: true,
      arrays: true,
      objects: true,
      oneofs: true,
    }
  );
  return fills.map((v) => ({
    offerHash: ethers.zeroPadValue(
      ethers.hexlify(ethers.decodeBase64(v.offerHash)),
      32
    ),
    amount: ethers.getUint(ethers.hexlify(ethers.decodeBase64(v.amount))),
  }));
}

export function scaleOffer(offer: any, amount: BigNumberish) {
  if (!offer.gets.amount || !offer.gives.amount) return offer;
  if (ethers.getUint(amount) > ethers.getUint(offer.gets.amount))
    throw Error("fill amount exceeds order capacity");
  const n = ethers.getUint(amount);
  const d = ethers.getUint(offer.gets.amount);
  if (n === d) return offer;
  return {
    gives: {
      tokenId: offer.gives.tokenId,
      token: offer.gives.token,
      amount: ethers.hexlify(
        ethers.toBeArray((ethers.getUint(offer.gives.amount) * n) / d)
      ),
    },
    gets: {
      token: offer.gets.token,
      tokenId: offer.gets.tokenId,
      amount: ethers.hexlify(ethers.toBeArray(ethers.getUint(amount))),
    },
  };
}

export function toBigIntFromBytes(b) {
  if (b === "0x" || b.length === 0) return BigInt(0);
  return ethers.toBigInt(b);
}

export function sumOffers(offers: any[]) {
  return offers.reduce(
    (r, v) => ({
      gets: {
        token: v.gets.token,
        amount:
          v.gets.amount &&
          ethers.toBeHex(
            toBigIntFromBytes(v.gets.amount) +
              toBigIntFromBytes(r.gets.amount || "0x0")
          ),
        tokenId: v.gets.tokenId,
      },
      gives: {
        token: v.gives.token,
        amount:
          v.gives.amount &&
          ethers.toBeHex(
            toBigIntFromBytes(v.gives.amount) +
              toBigIntFromBytes(r.gives.amount || "0x0")
          ),
        tokenId: v.gives.tokenId,
      },
    }),
    {
      gets: {},
      gives: {},
    }
  );
}

export const NS_MULTIADDRS = {
  BREAD: ["QmUtvU33iaHun99yD9HgiyLSrmPhWUbXVX2hAZRY4AEV2d"],
};

export interface IUserData {
  bio: string;
  image: Buffer;
}

export class Badswap extends BadP2P {
  public signer: any;
  public offers: Map<string, any> = new Map();
  public logger: ReturnType<typeof createLogger>;
  public peers: Map<string, [string, any]>;
  public userData: IUserData;
  public orderState: any;
  public _awaitReceipts: boolean;

  static async initialize({ awaitReceipts, signer }) {
    const peerId = await PeerId.create();
    return new Badswap({ signer, awaitReceipts, peerId });
  }

  async resolveName(name) {
    const parts = name.split(".");
    const query = parts.slice(0, Math.max(parts.length - 1, 1)).join(".");
    const tld = parts.length === 1 ? "riot" : parts[parts.length - 1];
    const messages = pushable();
    const response: any = await new Promise((resolve, reject) => {
      (async () => {
        const nsHosts = NS_MULTIADDRS[tld.toUpperCase()];
        const { stream } = await this.dialProtocol(
          PeerId.createFromB58String(
            nsHosts[Math.floor(nsHosts.length * Math.random())]
          ),
          "/badswap/0.1.0/ns/query"
        );
        pipe(messages, lp.encode(), stream.sink);
        messages.push(
          protocol.NameQuery.encode({
            name: query,
          }).finish()
        );
        messages.end();
        const it = pipe(stream.source, lp.decode());
        const response = protocol.NameQueryResponse.decode(
          (await it.next()).value.slice()
        );
        resolve({
          status: response.status,
          result: response.result,
        });
      })().catch(reject);
    });
    if (response.status === 0) throw Error("no name registered");
    return response.result + (parts.length > 1 ? "" : "." + tld);
  }
  async registerName(name) {
    let parts = name.split(".");
    const query = parts.slice(0, -1).join(".");
    const tld = parts[parts.length - 1];
    const messages = pushable();
    const response = await new Promise((resolve, reject) => {
      (async () => {
        const nsHosts = NS_MULTIADDRS[tld.toUpperCase()];
        const { stream } = await this.dialProtocol(
          PeerId.createFromB58String(
            nsHosts[Math.floor(nsHosts.length * Math.random())]
          ),
          "/badswap/0.1.0/ns/register"
        );
        pipe(messages, lp.encode(), stream.sink);
        messages.push(Buffer.from(query));
        messages.end();
        const it = await pipe(stream.source, lp.decode());
        const response = protocol.NameRegisterResponse.decode(
          (await it.next()).value.slice()
        );
        resolve({
          status: response.status,
        });
      })().catch(reject);
    });
    return response;
  }
  constructor({ awaitReceipts, signer, peerId, userData, offers }: any) {
    super({ signer, peerId });
    this.signer = signer;
    this.logger = logger;
    this.peers = new Map<string, [string, any]>();
    this.offers = offers || new Map<string, any>();
    this.userData = userData || {
      bio: "",
      image: Buffer.from([]),
    };
    this.orderState = {};
    this._awaitReceipts = awaitReceipts || false;
  }
  setBio(s: string) {
    this.userData.bio = s;
  }
  setImage(b: Buffer) {
    this.userData.image = b;
  }
  async publishOffers() {
    await this.pubsub.publish(
      "/badswap/0.1.0/publish-orders",
      ethers.toBeArray(ethers.hexlify(this._encodeOffers()))
    );
  }
  startPublishingOffers(ms: number) {
    if (!ms) ms = 10000;
    let end = false;
    (async () => {
      while (!end) {
        try {
          await this.publishOffers();
        } catch (e) {
          this.logger.error(e);
        }
        await new Promise((resolve) => setTimeout(resolve, ms));
      }
    })().catch((err) => this.logger.error(err));
    return {
      setInterval(_ms) {
        ms = _ms;
      },
      stop() {
        end = true;
      },
    };
  }
  async subscribeOffers() {
    this.pubsub.on("/badswap/0.1.0/publish-orders", (message) => {
      try {
        this.logger.debug(
          `\n PUBSUB: TOPIC-${message.topicIDs[0]} \n FROM: PEER-${message.from}`
        );
        this.logger.info(message.data);
        const offers = this._decodeOffers(message.data).offers;
        let _offerhash = ethers.keccak256(message.data);
        const pair: [string, any] = [_offerhash, offers];
        this.logger.info(pair);
        if (this.peers.has(message.from)) {
          if (this.peers.get(message.from)[0] == _offerhash) return;
          this.peers.set(message.from, pair);
          this.emit("/pubsub/orderbook-update");
          return;
        }
        this.peers.set(message.from, pair);
        this.emit("/pubsub/orderbook-update");
      } catch (e) {
        this.logger.error(e);
      }
    });
    this.pubsub.subscribe("/badswap/0.1.0/publish-orders");
  }
  async startNode() {
    await this.handleBroadcastedOffers();
    await this.handleUserData();
    await this.start();
    await this.pubsub.start();
    this.emit(`badswap/node/status`, 1);
  }

  async stopNode() {
    await this.unhandle([
      "/badswap/0.1.0/orders",
      "/badswap/0.1.0/create-trade",
    ]);
    await this.stop();
    this.emit(`badswap/node/status`, 0);
  }

  toObject() {
    return {
      peerId: this.peerId.toJSON(),
      userData: {
        bio: this.userData.bio,
        image: this.userData.image.toString("base64"),
      },
      offers: [...this.offers.values()],
    };
  }
  static async fromObject(o, signer) {
    const initArg = {
      ...o,
      userData: o.userData && {
        bio: o.userData.bio,
        image: Buffer.from(o.userData.image, "base64"),
      },
      offers:
        o.offers &&
        new Map<string, any>(o.offers.map((v) => [hashOffer(v), v])),
      peerId: o.peerId && (await PeerId.createFromJSON(o.peerId)),
      signer,
    };
    return new Badswap(initArg);
  }
  _encodeOffers() {
    return protocol.OfferList.encode({
      offers: [...this.offers.values()].map((v) =>
        Object.fromEntries(
          Object.entries(v).map(([key, value]) => [
            key,
            toTypedTransfer(
              mapValues(value, (v) => Buffer.from(ethers.toBeArray(v)))
            ),
          ])
        )
      ),
    }).finish();
  }
  _encodeUserData() {
    return protocol.UserData.encode({
      offers: [...this.offers.values()].map((v) =>
        Object.fromEntries(
          Object.entries(v).map(([key, value]) => [
            key,
            toTypedTransfer(
              mapValues(value, (v) => Buffer.from(ethers.toBeArray(v)))
            ),
          ])
        )
      ),
      image: this.userData.image,
      bio: this.userData.bio,
    }).finish();
  }
  async handleUserData() {
    await this.handle("/badswap/0.1.0/userdata", ({ stream }) => {
      try {
        this.logger.debug("handling userdata request");
        this.emit("badswap/trade/peer", 2);
        let userData = this._encodeUserData();
        const messages = pushable();
        pipe(messages, lp.encode(), stream.sink);
        messages.push(userData);
        messages.end();
      } catch (e) {
        this.logger.error(e);
      }
    });
  }
  async handleBroadcastedOffers() {
    const address = await this.signer.getAddress();
    await this.handle("/badswap/0.1.0/orders", ({ stream }) => {
      try {
        this.logger.debug("handling order request from peer");
        this.emit("badswap/trade/peer", 2); // maker sees that taker is connected
        let offerList = this._encodeOffers();
        const messages = pushable();
        pipe(messages, lp.encode(), stream.sink);
        messages.push(offerList);
        messages.end();
      } catch (e) {
        this.logger.error(e);
      }
    });

    await this.handle(
      "/badswap/0.1.0/check-trade",
      async ({ stream, connection, protocol }) => {
        const messages = pushable();
        const source = pipe(stream.source, lp.decode());
        const sinkPromise = pipe(messages, lp.encode(), stream.sink);
        try {
          const fillRequest = this._decodeTradeRequest(
            (await source.next()).value.slice()
          );
          const canFill = await this.canFill(fillRequest.offer.gets);

          messages.push(
            this._encodeCheckTradeResponse({
              result: {
                volume: canFill,
              },
            })
          );
        } catch (e) {
          this.logger.error(e);
          messages.push(
            this._encodeCheckTradeResponse({
              error: {
                code: "UNEXPECTED",
              },
            })
          );
        }
        messages.end();
        await sinkPromise;
      }
    );
    await this.handle(
      "/badswap/0.1.0/create-trade",
      async ({ stream, connection, protocol }) => {
        const messages = pushable();
        const source = pipe(stream.source, lp.decode());
        const sinkPromise = pipe(messages, lp.encode(), stream.sink);
        try {
          const tradeRequestBytes = (await source.next()).value.slice();
          const fillRequest = this._decodeTradeRequest(tradeRequestBytes);
          const canFill = await this.canFill(fillRequest.offer.gets);

          messages.push(
            this._encodeCheckTradeResponse({
              result: {
                volume: canFill,
              },
            })
          );
          await source.next();
          messages.push(
            this._encodeCreateTradeResponse({
              fill: {
                maker: await this.signer.getAddress(),
                taker: fillRequest.address,
                offer: fillRequest.offer,
                nonce: fillRequest.nonce,
                amount: canFill,
              },
            })
          );
        } catch (e) {
          this.logger.error(e);
          messages.push(
            this._encodeTradeResponse({
              error: {
                code: "UNEXPECTED",
              },
            })
          );
        }
        messages.end();
        await sinkPromise;
      }
    );
    await this.handle(
      "/badswap/0.1.0/notify-escrow",
      async ({ stream, connection, protocol }) => {
        const messages = pushable();
        const source = pipe(stream.source, lp.decode());
        const sinkPromise = pipe(messages, lp.encode(), stream.sink);
        try {
          const notifyEscrowRequestBytes = (await source.next()).value.slice();
          const notifyEscrowRequest = this._decodeNotifyEscrowRequest(
            notifyEscrowRequestBytes
          );
          const { transactionHash } = notifyEscrowRequest;
          this.logger.info("escrow creation tx|" + transactionHash);
          await this.signer.provider.waitForTransaction(transactionHash);
          const { data, nonce, from } =
            await this.signer.provider.getTransaction(transactionHash);
          const contractAddress = getCreateAddress({ nonce, from });
          this.logger.info("escrow contract|" + contractAddress);
          const isValid = await this.validateEscrowContract(
            data,
            notifyEscrowRequest,
            await this.signer.getAddress()
          );
          if (!isValid) throw Error("escrow bytecode invalid");
          if (this.orderState[transactionHash]) throw Error("already notified");
          this.orderState[transactionHash] = {
            ...notifyEscrowRequest,
          };
          this.emit("notify-escrow", transactionHash);
          messages.push(
            this._encodeNotifyEscrowResponse({
              transactionHash,
            })
          );
        } catch (e) {
          this.logger.error(e);
          messages.push(
            this._encodeTradeResponse({
              error: {
                code: "UNEXPECTED",
              },
            })
          );
        }
        messages.end();
        await sinkPromise;
      }
    );
  }
  async fillOffer(transactionHash) {
    const order = this.orderState[transactionHash];
    if (!order) throw Error("no order found");
    /* fill via any means */
    const proof = {};
    order.status = "FILLED";
    order.proof = proof;
    this.emit("offer-filled", { ...order });
  }
  async request(peerId, protocolTag, payload, encode, decode) {
    const { stream } = await this.dialProtocol(peerId, protocolTag);
    const decoded = pipe(stream.source, lp.decode());
    const sinkPromise = pipe(messages, lp.encode(), stream.sink);
    messages.push(encode(payload));
    messages.end();
    const result = decode((await decoded.next()).value.slice());
    await sinkPromise;
    return result;
  }
  async checkTrade(peerId, offer) {
    return await this.request(
      peerId,
      "/badswap/0.1.0/check-trade",
      offer,
      (offer) => this._encodeCheckTradeRequest(offer),
      (responseBytes) => this._decodeCheckTradeResponse(responseBytes)
    );
  }
  async createTrade(peerId, offer) {
    return await this.request(
      peerId,
      "/badswap/0.1.0/create-trade",
      offer,
      (offer) => this._encodeCreateTradeRequest(offer),
      (responseBytes) => this._decodeCreateTradeResponse(responseBytes)
    );
  }
  async trade(peerId, offer) {
    const isAvailable = await this.checkTrade(peerId, offer);
    if (!isAvailable) throw Error('counterparty cannot fill trade');
    const { maker, taker, offer } = await this.createTrade(peerId, offer);
    const tradeAddress = await this.getTradeAddress(await this.signer.getAddress());
    const tx = await this.approveTrade(offer.gives, tradeAddress);
    this.logger.info('approve|' + tx.hash);
    if (this._awaitReceipts) await tx.wait();
    this.logger.info('approve|success!');
    const contract = await this.prepareTransaction(offer, maker, taker tx.permitData || null);
    const escrowTransaction = await this.signer.sendTransaction({
      data: contract
    });
    const transactionHash = escrowTransaction.hash;
    const order = this.orderState[transactionHash] = {
      status: 'AWAIT_NOTIFY',
      peerId,
      transactionHash
    };
    this.logger.info('escrow|' + transactionHash);
    await escrowTransaction.wait();
    this.emit('escrow-created', order);
    return await new Promise((resolve, reject) => {
      const listener = (_transactionHash) => {
        if (transactionHash === _transactionHash) {
          this.removeListener('trade-complete', listener);
	  resolve(this.orderState[transactionHash]);
	}
      };
      this.on('trade-complete', listener);
    });
  }
  async requestProof(transactionHash) {
    const order = this.orderState[transactionHash];
    return await this.request(order.peerId, '/badswap/0.1.0/request-proof', order, (order) => this._encodeRequestProofRequest(order), (responseBytes) => this._decodeRequestProofResponse(order));
  }
  async notifyEscrow(transactionHash) {
    const order = this.orderState[transactionHash];
    return await this.request(
      order.peerId,
      "/badswap/0.1.0/notify-escrow",
      order,
      (order) => this._encodeNotifyEscrowRequest(order),
      (responseBytes) => this._decodeNotifyEscrowResponse(order)
    );
  }
  async requestSecret(transactionHash) {
    const order = this.orderState[transationHash];
    const response = await this.request(
      order.peerId,
      "/badswap/0.1.0/request-secret",
      order,
      (order) => this._encodeRequestSecretRequest(order),
      (responseBytes) => this._decodeRequestSecretResponse(responseBytes)
    );
    const orderWithSecret = (this.orderState[transactionHash] = {
      ...order,
      secret: response.secret,
    });
    this.logger.info("secret|" + orderWithSecret.secret);
    this.emit("received-secret", orderWithSecret);
    return response;
  }
  async getEscrowAddress(transactionHash) {
    return (await this.signer.provider.getTransactionReceipt(transactionHash))
      .contractAddress;
  }
  async spendSecretForTransactionHash(transactionHash) {
    const escrowAddress = await this.getEscrowAddress();
    const order = this.orderState[transactionHash];
    const secret = order.secret;
    return await this.spendSecret(escrowAddress, secret);
  }
  async spendSecret(escrowAddress, secret) {
    const tx = await this.signer.sendTransaction({
      data: ethers.toBeArray(secret),
      to: escrowAddress,
    });
    this.emit("spend-secret", {
      escrowAddress,
      secret,
      txHash: tx.hash,
    });
    return tx;
  }

  // adds new offer to this.offers: Map<hash, any>
  broadcastOffer(_offer: any) {
    this.logger.debug("trying to list new offer");
    const hash = hashOffer(_offer);
    this.offers.set(hash, _offer);
    this.emit("badswap/trade/broadcast", hash);
  }
  async getUserDataByPeerId(peerId: string) {
    let pid = PeerId.createFromB58String(peerId);
    while (true) {
      try {
        await this.peerRouting.findPeer(pid);
        break;
      } catch (e) {
        this.logger.error(e);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    this.emit("badswap/trade/peer", 0); // start finding peer's orders
    const { stream } = await this.dialProtocol(pid, "/badswap/0.1.0/userdata");
    this.emit("badswap/trade/peer", 1); // peer found
    const decoded = pipe(stream.source, lp.decode());
    const { value: userDataBufferList } = await decoded.next();
    const result = userDataBufferList.slice();
    this.emit("badswap/trade/peer", 2); // got offers
    const userData = this._decodeUserData(result);
    this.emit("badswap/trade/peer", 3); // offers decoded and returning
    return userData;
  }

  // Takes in a peerId and returns a list of exisiting trades
  async getTradesByPeerId(peerId: string) {
    let pid = PeerId.createFromB58String(peerId);
    while (true) {
      try {
        await this.peerRouting.findPeer(pid);
        break;
      } catch (e) {
        this.logger.error(e);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    this.emit("badswap/trade/peer", 0); // start finding peer's orders
    const { stream } = await this.dialProtocol(pid, "/badswap/0.1.0/orders");
    this.emit("badswap/trade/peer", 1); // peer found
    const decoded = pipe(stream.source, lp.decode());
    const { value: offerListBufferList } = await decoded.next();
    const result = offerListBufferList.slice();
    this.emit("badswap/trade/peer", 2); // got offers
    const offerList = this._decodeOffers(result);
    this.emit("badswap/trade/peer", 3); // offers decoded and returning
    return offerList;
  }
  _decodeOffers(data: Buffer) {
    let offerList = protocol.OfferList.toObject(
      protocol.OfferList.decode(data),
      {
        enums: String,
        longs: String,
        bytes: String,
        defaults: true,
        arrays: true,
        objects: true,
        oneofs: true,
      }
    );

    const offers = protobufOffersToHex(offerList.offers);
    return Object.assign(offerList, { offers });
  }
  _decodeUserData(data: Buffer) {
    let userData = protocol.UserData.toObject(protocol.UserData.decode(data), {
      enums: String,
      longs: String,
      bytes: String,
      defaults: true,
      arrays: true,
      objects: true,
      oneofs: true,
    });

    const offers = protobufOffersToHex(userData.offers);
    return {
      offers,
      image: Buffer.from(ethers.decodeBase64(userData.image)),
      bio: userData.bio,
    };
  }
  async getTradeAddress(sharedAddress: string) {
    const address = getCreateAddress({
      nonce: await this.signer.provider.getTransactionCount(sharedAddress),
      from: sharedAddress,
    });
    this.logger.debug("TRADE ADDRESS: " + address);
    return address;
  }
  async approveTrade(transfer: any, sharedAddress: string) {
    const tradeAddress = await this.getTradeAddress(sharedAddress);
    if (isERC721Transfer(transfer) || isERC1155Transfer(transfer)) {
      if (await detectERC721Permit(transfer.token, this.signer)) {
        const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
        const permitData = await erc721Permit.signAndMergeERC721(
          {
            asset: transfer.token,
            tokenId: transfer.tokenId,
            spender: tradeAddress,
            owner: await this.signer.getAddress(),
            expiry,
          },
          this.signer
        );
        return {
          permitData,
          async wait() {
            return {};
          },
        };
      }
      const token = new Contract(
        transfer.token,
        [
          "function setApprovalForAll(address, bool)",
          "function isApprovedForAll(address, address) view returns (bool)",
        ],
        this.signer
      );
      if (
        !(await token.isApprovedForAll(
          await this.signer.getAddress(),
          tradeAddress
        ))
      ) {
        return await token.setApprovalForAll(tradeAddress, true);
      }
      return {
        async wait() {
          return {};
        },
      };
    }
    const token = new Contract(
      await coerceToWeth(ethers.getAddress(transfer.token), this.signer),
      genericAbi,
      this.signer
    );
    this.logger.debug("ADDRESS", await this.signer.getAddress());
    this.logger.debug(
      "BALANCE BEFORE APPROVING " +
        ethers.formatEther(
          await token.balanceOf(await this.signer.getAddress())
        )
    );
    if (transfer.token === ethers.ZeroAddress) {
      const { chainId } = await this.signer.provider.getNetwork();
      const weth = new ethers.Contract(
        toWETH(Number(chainId)),
        [
          "function deposit()",
          "function balanceOf(address) view returns (uint256)",
        ],
        this.signer
      );
      const wethBalance = ethers.toBigInt(
        await weth.balanceOf(await this.signer.getAddress())
      );
      if (wethBalance < ethers.toBigInt(transfer.amount)) {
        const depositTx = await weth.deposit({
          value: ethers.toBigInt(transfer.amount) - wethBalance,
        });
        if (this._awaitReceipts)
          await this.signer.provider.waitForTransaction(depositTx.hash);
      }
      this.logger.debug(
        "WETH BALANCE " +
          ethers.formatEther(
            await weth.balanceOf(await this.signer.getAddress())
          )
      );
    }
    if (await detectPermit(transfer.token, this.signer)) {
      const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
      const permitData = await permit.sign(
        {
          asset: transfer.token,
          value: transfer.amount,
          spender: tradeAddress,
          owner: await this.signer.getAddress(),
          expiry,
        },
        this.signer
      );
      return {
        permitData,
        async wait() {
          return {};
        },
      };
    } else if (
      Number((await this.signer.provider.getNetwork()).chainId) === 1
    ) {
      const tx = await this.approvePermit2(transfer.token);
      if (tx && this._awaitReceipts)
        await this.signer.provider.waitForTransaction(tx.hash);
      const signatureTransfer = {
        permit: {
          permitted: {
            token: await coerceToWeth(transfer.token, this.signer),
            amount: transfer.amount,
          },
          spender: tradeAddress,
          nonce: ethers.hexlify(
            ethers.toBeArray(ethers.getUint(Math.floor(Date.now() / 1000)))
          ),
          deadline: ethers.hexlify(
            ethers.toBeArray(
              ethers.getUint(Math.floor(Date.now() / 1000)) +
                BigInt(60 * 60 * 24)
            )
          ),
        },
        permit2Address: PERMIT2_ADDRESS,
        chainId: 1,
      };
      const signature = await signTypedData(
        this.signer,
        ...getPermitData(signatureTransfer)
      );
      return {
        permitData: {
          signatureTransfer: signatureTransfer.permit,
          signature,
        },
        async wait() {
          return {};
        },
      };
    } else {
      const tx = await token.approve(tradeAddress, transfer.amount);
      this.logger.debug("TRADE ADDRESS", tradeAddress);
      this.logger.debug(
        "BALANCE AFTER APPROVING " +
          ethers.formatEther(
            await token.balanceOf(await this.signer.getAddress())
          )
      );
      this.logger.debug(
        "ALLOWANCE AFTER APPROVING " +
          ethers.formatEther(
            await token.allowance(await this.signer.getAddress(), tradeAddress)
          )
      );
      return tx;
    }
  }
  async approvePermit2(asset: string) {
    const token = new Contract(
      await coerceToWeth(asset, this.signer),
      genericAbi,
      this.signer
    );
    const allowance = await token.allowance(
      await this.signer.getAddress(),
      PERMIT2_ADDRESS
    );
    if (ethers.getUint(allowance) < ethers.getUint("0x0" + "f".repeat(63))) {
      return await token.approve(PERMIT2_ADDRESS, ethers.MaxUint256);
    }
    return null;
  }

  async prepareTransaction(
    offer: any,
    maker: string,
    taker: string,
    permitData: any
  ) {
    const contract = createContract(
      offer.gives,
      Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      ethers.hexlify(randomBytes(32)),
      maker,
      taker,
      (await this.signer.getNetwork()).chainId,
      permitData
    );
    return contract;
  }

  createTrade(peer, offer) {
    return this.createBatchTrade(peer, [
      {
        offer,
        amount: offer.gets.amount || offer.gets.tokenId,
      },
    ]);
  }
  createBatchTrade(peer, batchFill) {
    const trade = new BadswapTrade();
    trade.hashes = batchFill.map((v) => hashOffer(v.offer));
    this.emit("trade:taker", trade);
    (async () => {})().catch((err) => trade.reject(err));
    return trade;
  }
}
