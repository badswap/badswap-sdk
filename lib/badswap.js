"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Badswap = exports.NS_MULTIADDRS = exports.sumOffers = exports.toBigIntFromBytes = exports.scaleOffer = exports.decodeBatchFill = exports.encodeBatchFill = exports.BadswapTrade = exports.sendFlashbotsTransaction = exports.protobufOffersToHex = void 0;
const protocol_1 = require("./protocol");
const p2p_1 = require("./p2p");
const ethers_1 = require("ethers");
const it_pipe_1 = require("it-pipe");
const lp = __importStar(require("it-length-prefixed"));
const random_bytes_1 = require("random-bytes");
const events_1 = require("events");
const permit2_sdk_1 = require("@uniswap/permit2-sdk");
const it_pushable_1 = __importDefault(require("it-pushable"));
const lodash_1 = require("lodash");
const trade_1 = require("./trade");
const trade_2 = require("./trade");
const peer_id_1 = __importDefault(require("peer-id"));
const logger_1 = require("./logger");
const permit = __importStar(require("@pintswap/sdk/lib/permit"));
const erc721Permit = __importStar(require("@pintswap/sdk/lib/erc721-permit"));
const detect_permit_1 = require("@pintswap/sdk/lib/detect-permit");
const detect_erc721_permit_1 = require("@pintswap/sdk/lib/detect-erc721-permit");
const cross_fetch_1 = __importDefault(require("cross-fetch"));
const { getAddress, getCreateAddress, Contract, Transaction } = ethers_1.ethers;
const logger = (0, logger_1.createLogger)("badswap");
const toTypedTransfer = (transfer) => Object.fromEntries([
    [
        (0, trade_2.isERC20Transfer)(transfer)
            ? "erc20"
            : (0, trade_2.isERC721Transfer)(transfer)
                ? "erc721"
                : (0, trade_2.isERC721Transfer)(transfer)
                    ? "erc1155"
                    : (() => {
                        throw Error("no token type found");
                    })(),
        transfer,
    ],
]);
const protobufOffersToHex = (offers) => offers.map((v) => {
    return (0, lodash_1.mapValues)(v, (v) => {
        const transfer = v[v.data];
        const o = {};
        if (["erc20", "erc1155"].includes(v.data))
            o.amount = ethers_1.ethers.hexlify(ethers_1.ethers.decodeBase64(transfer.amount));
        if (["erc721", "erc1155"].includes(v.data))
            o.tokenId = ethers_1.ethers.hexlify(ethers_1.ethers.decodeBase64(transfer.tokenId));
        o.token = ethers_1.ethers.getAddress(ethers_1.ethers.zeroPadValue(ethers_1.ethers.decodeBase64(transfer.token), 20));
        return o;
    });
});
exports.protobufOffersToHex = protobufOffersToHex;
const getGasPrice = (provider) => __awaiter(void 0, void 0, void 0, function* () {
    if (provider.getGasPrice)
        return yield provider.getGasPrice();
    return (yield provider.getFeeData()).gasPrice;
});
const signTypedData = (signer, ...args) => __awaiter(void 0, void 0, void 0, function* () {
    if (signer.signTypedData)
        return yield signer.signTypedData(...args);
    return yield signer._signTypedData(...args);
});
let id = 0;
function sendFlashbotsTransaction(data) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield (0, cross_fetch_1.default)("https://rpc.flashbots.net", {
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
        return yield response.json();
    });
}
exports.sendFlashbotsTransaction = sendFlashbotsTransaction;
const getPermitData = (signatureTransfer) => {
    const { domain, types, values } = permit2_sdk_1.SignatureTransfer.getPermitData(signatureTransfer.permit, signatureTransfer.permit2Address, signatureTransfer.chainId);
    return [domain, types, values];
};
class BadswapTrade extends events_1.EventEmitter {
    constructor() {
        super();
        this._deferred = (0, trade_2.defer)();
        this.hashes = null;
    }
    toPromise() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this._deferred.promise;
        });
    }
    resolve(v) {
        this.emit("complete", v);
        this._deferred.resolve(v);
    }
    reject(err) {
        this.emit("error", err);
        this._deferred.reject(err);
    }
}
exports.BadswapTrade = BadswapTrade;
function encodeBatchFill(o) {
    return protocol_1.protocol.BatchFill.encode({
        fills: o.map((v) => ({
            offerHash: Buffer.from(ethers_1.ethers.toBeArray(v.offerHash)),
            amount: Buffer.from(ethers_1.ethers.toBeArray(ethers_1.ethers.getUint(v.amount))),
        })),
    }).finish();
}
exports.encodeBatchFill = encodeBatchFill;
function decodeBatchFill(data) {
    const { fills } = protocol_1.protocol.BatchFill.toObject(protocol_1.protocol.BatchFill.decode(data), {
        enums: String,
        longs: String,
        bytes: String,
        defaults: true,
        arrays: true,
        objects: true,
        oneofs: true,
    });
    return fills.map((v) => ({
        offerHash: ethers_1.ethers.zeroPadValue(ethers_1.ethers.hexlify(ethers_1.ethers.decodeBase64(v.offerHash)), 32),
        amount: ethers_1.ethers.getUint(ethers_1.ethers.hexlify(ethers_1.ethers.decodeBase64(v.amount))),
    }));
}
exports.decodeBatchFill = decodeBatchFill;
function scaleOffer(offer, amount) {
    if (!offer.gets.amount || !offer.gives.amount)
        return offer;
    if (ethers_1.ethers.getUint(amount) > ethers_1.ethers.getUint(offer.gets.amount))
        throw Error("fill amount exceeds order capacity");
    const n = ethers_1.ethers.getUint(amount);
    const d = ethers_1.ethers.getUint(offer.gets.amount);
    if (n === d)
        return offer;
    return {
        gives: {
            tokenId: offer.gives.tokenId,
            token: offer.gives.token,
            amount: ethers_1.ethers.hexlify(ethers_1.ethers.toBeArray((ethers_1.ethers.getUint(offer.gives.amount) * n) / d)),
        },
        gets: {
            token: offer.gets.token,
            tokenId: offer.gets.tokenId,
            amount: ethers_1.ethers.hexlify(ethers_1.ethers.toBeArray(ethers_1.ethers.getUint(amount))),
        },
    };
}
exports.scaleOffer = scaleOffer;
function toBigIntFromBytes(b) {
    if (b === "0x" || b.length === 0)
        return BigInt(0);
    return ethers_1.ethers.toBigInt(b);
}
exports.toBigIntFromBytes = toBigIntFromBytes;
function sumOffers(offers) {
    return offers.reduce((r, v) => ({
        gets: {
            token: v.gets.token,
            amount: v.gets.amount &&
                ethers_1.ethers.toBeHex(toBigIntFromBytes(v.gets.amount) +
                    toBigIntFromBytes(r.gets.amount || "0x0")),
            tokenId: v.gets.tokenId,
        },
        gives: {
            token: v.gives.token,
            amount: v.gives.amount &&
                ethers_1.ethers.toBeHex(toBigIntFromBytes(v.gives.amount) +
                    toBigIntFromBytes(r.gives.amount || "0x0")),
            tokenId: v.gives.tokenId,
        },
    }), {
        gets: {},
        gives: {},
    });
}
exports.sumOffers = sumOffers;
exports.NS_MULTIADDRS = {
    BREAD: ["QmUtvU33iaHun99yD9HgiyLSrmPhWUbXVX2hAZRY4AEV2d"],
};
class Badswap extends p2p_1.BadP2P {
    static initialize({ awaitReceipts, signer }) {
        return __awaiter(this, void 0, void 0, function* () {
            const peerId = yield peer_id_1.default.create();
            return new Badswap({ signer, awaitReceipts, peerId });
        });
    }
    resolveName(name) {
        return __awaiter(this, void 0, void 0, function* () {
            const parts = name.split(".");
            const query = parts.slice(0, Math.max(parts.length - 1, 1)).join(".");
            const tld = parts.length === 1 ? "riot" : parts[parts.length - 1];
            const messages = (0, it_pushable_1.default)();
            const response = yield new Promise((resolve, reject) => {
                (() => __awaiter(this, void 0, void 0, function* () {
                    const nsHosts = exports.NS_MULTIADDRS[tld.toUpperCase()];
                    const { stream } = yield this.dialProtocol(peer_id_1.default.createFromB58String(nsHosts[Math.floor(nsHosts.length * Math.random())]), "/badswap/0.1.0/ns/query");
                    (0, it_pipe_1.pipe)(messages, lp.encode(), stream.sink);
                    messages.push(protocol_1.protocol.NameQuery.encode({
                        name: query,
                    }).finish());
                    messages.end();
                    const it = (0, it_pipe_1.pipe)(stream.source, lp.decode());
                    const response = protocol_1.protocol.NameQueryResponse.decode((yield it.next()).value.slice());
                    resolve({
                        status: response.status,
                        result: response.result,
                    });
                }))().catch(reject);
            });
            if (response.status === 0)
                throw Error("no name registered");
            return response.result + (parts.length > 1 ? "" : "." + tld);
        });
    }
    registerName(name) {
        return __awaiter(this, void 0, void 0, function* () {
            let parts = name.split(".");
            const query = parts.slice(0, -1).join(".");
            const tld = parts[parts.length - 1];
            const messages = (0, it_pushable_1.default)();
            const response = yield new Promise((resolve, reject) => {
                (() => __awaiter(this, void 0, void 0, function* () {
                    const nsHosts = exports.NS_MULTIADDRS[tld.toUpperCase()];
                    const { stream } = yield this.dialProtocol(peer_id_1.default.createFromB58String(nsHosts[Math.floor(nsHosts.length * Math.random())]), "/badswap/0.1.0/ns/register");
                    (0, it_pipe_1.pipe)(messages, lp.encode(), stream.sink);
                    messages.push(Buffer.from(query));
                    messages.end();
                    const it = yield (0, it_pipe_1.pipe)(stream.source, lp.decode());
                    const response = protocol_1.protocol.NameRegisterResponse.decode((yield it.next()).value.slice());
                    resolve({
                        status: response.status,
                    });
                }))().catch(reject);
            });
            return response;
        });
    }
    constructor({ awaitReceipts, signer, peerId, userData, offers }) {
        super({ signer, peerId });
        this.offers = new Map();
        this.signer = signer;
        this.logger = logger;
        this.peers = new Map();
        this.offers = offers || new Map();
        this.userData = userData || {
            bio: "",
            image: Buffer.from([]),
        };
        this._awaitReceipts = awaitReceipts || false;
    }
    setBio(s) {
        this.userData.bio = s;
    }
    setImage(b) {
        this.userData.image = b;
    }
    publishOffers() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.pubsub.publish("/badswap/0.1.0/publish-orders", ethers_1.ethers.toBeArray(ethers_1.ethers.hexlify(this._encodeOffers())));
        });
    }
    startPublishingOffers(ms) {
        if (!ms)
            ms = 10000;
        let end = false;
        (() => __awaiter(this, void 0, void 0, function* () {
            while (!end) {
                try {
                    yield this.publishOffers();
                }
                catch (e) {
                    this.logger.error(e);
                }
                yield new Promise((resolve) => setTimeout(resolve, ms));
            }
        }))().catch((err) => this.logger.error(err));
        return {
            setInterval(_ms) {
                ms = _ms;
            },
            stop() {
                end = true;
            },
        };
    }
    subscribeOffers() {
        return __awaiter(this, void 0, void 0, function* () {
            this.pubsub.on("/badswap/0.1.0/publish-orders", (message) => {
                try {
                    this.logger.debug(`\n PUBSUB: TOPIC-${message.topicIDs[0]} \n FROM: PEER-${message.from}`);
                    this.logger.info(message.data);
                    const offers = this._decodeOffers(message.data).offers;
                    let _offerhash = ethers_1.ethers.keccak256(message.data);
                    const pair = [_offerhash, offers];
                    this.logger.info(pair);
                    if (this.peers.has(message.from)) {
                        if (this.peers.get(message.from)[0] == _offerhash)
                            return;
                        this.peers.set(message.from, pair);
                        this.emit("/pubsub/orderbook-update");
                        return;
                    }
                    this.peers.set(message.from, pair);
                    this.emit("/pubsub/orderbook-update");
                }
                catch (e) {
                    this.logger.error(e);
                }
            });
            this.pubsub.subscribe("/badswap/0.1.0/publish-orders");
        });
    }
    startNode() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.handleBroadcastedOffers();
            yield this.handleUserData();
            yield this.start();
            yield this.pubsub.start();
            this.emit(`badswap/node/status`, 1);
        });
    }
    stopNode() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.unhandle([
                "/badswap/0.1.0/orders",
                "/badswap/0.1.0/create-trade",
            ]);
            yield this.stop();
            this.emit(`badswap/node/status`, 0);
        });
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
    static fromObject(o, signer) {
        return __awaiter(this, void 0, void 0, function* () {
            const initArg = Object.assign(Object.assign({}, o), { userData: o.userData && {
                    bio: o.userData.bio,
                    image: Buffer.from(o.userData.image, "base64"),
                }, offers: o.offers &&
                    new Map(o.offers.map((v) => [(0, trade_2.hashOffer)(v), v])), peerId: o.peerId && (yield peer_id_1.default.createFromJSON(o.peerId)), signer });
            return new Badswap(initArg);
        });
    }
    _encodeOffers() {
        return protocol_1.protocol.OfferList.encode({
            offers: [...this.offers.values()].map((v) => Object.fromEntries(Object.entries(v).map(([key, value]) => [
                key,
                toTypedTransfer((0, lodash_1.mapValues)(value, (v) => Buffer.from(ethers_1.ethers.toBeArray(v)))),
            ]))),
        }).finish();
    }
    _encodeUserData() {
        return protocol_1.protocol.UserData.encode({
            offers: [...this.offers.values()].map((v) => Object.fromEntries(Object.entries(v).map(([key, value]) => [
                key,
                toTypedTransfer((0, lodash_1.mapValues)(value, (v) => Buffer.from(ethers_1.ethers.toBeArray(v)))),
            ]))),
            image: this.userData.image,
            bio: this.userData.bio,
        }).finish();
    }
    handleUserData() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.handle("/badswap/0.1.0/userdata", ({ stream }) => {
                try {
                    this.logger.debug("handling userdata request");
                    this.emit("badswap/trade/peer", 2);
                    let userData = this._encodeUserData();
                    const messages = (0, it_pushable_1.default)();
                    (0, it_pipe_1.pipe)(messages, lp.encode(), stream.sink);
                    messages.push(userData);
                    messages.end();
                }
                catch (e) {
                    this.logger.error(e);
                }
            });
        });
    }
    handleBroadcastedOffers() {
        return __awaiter(this, void 0, void 0, function* () {
            const address = yield this.signer.getAddress();
            yield this.handle("/badswap/0.1.0/orders", ({ stream }) => {
                try {
                    this.logger.debug("handling order request from peer");
                    this.emit("badswap/trade/peer", 2); // maker sees that taker is connected
                    let offerList = this._encodeOffers();
                    const messages = (0, it_pushable_1.default)();
                    (0, it_pipe_1.pipe)(messages, lp.encode(), stream.sink);
                    messages.push(offerList);
                    messages.end();
                }
                catch (e) {
                    this.logger.error(e);
                }
            });
            yield this.handle("/badswap/0.1.0/create-trade", ({ stream, connection, protocol }) => __awaiter(this, void 0, void 0, function* () {
                const messages = (0, it_pushable_1.default)();
                const source = (0, it_pipe_1.pipe)(stream.source, lp.decode());
                const sinkPromise = (0, it_pipe_1.pipe)(messages, lp.encode());
                const fillRequest = this._decodeOfferFillRequest((yield source.next()).value.slice());
                const canFill = yield this.canFill(fillRequest.offer.gets);
                if (!canFill) {
                    messages.end();
                    return;
                }
                messages.push(yield this.signer.getAddress());
                const transactionHash = ethers_1.ethers.hexlify((yield source.next()).value.slice());
                this.logger.info('escrow creation tx|' + transactionHash);
                yield this.signer.provider.waitForTransaction(transactionHash);
                const { data, nonce, from } = yield this.signer.provider.getTransaction(transactionHash);
                const contractAddress = getCreateAddress({ nonce, from });
                this.logger.info('escrow contract|' + contractAddress);
                const isValid = yield this.validateEscrowContract(data, fillRequest, yield this.signer.getAddress());
                if (!isValid) {
                    messages.end();
                    return;
                }
                const proof = yield this.fillOffer(fillRequest);
                messages.push(proof);
                const secret = ethers_1.ethers.hexlify((yield source.next()).value);
                this.logger.info('secret|' + secret);
                const tx = yield this.signer.sendTransaction({
                    to: contractAddress,
                    data: secret
                });
                this.logger.info('release escrow tx|' + tx.hash);
                messages.end();
                yield sinkPromise;
            }));
        });
    }
    // adds new offer to this.offers: Map<hash, any>
    broadcastOffer(_offer) {
        this.logger.debug("trying to list new offer");
        const hash = (0, trade_2.hashOffer)(_offer);
        this.offers.set(hash, _offer);
        this.emit("badswap/trade/broadcast", hash);
    }
    getUserDataByPeerId(peerId) {
        return __awaiter(this, void 0, void 0, function* () {
            let pid = peer_id_1.default.createFromB58String(peerId);
            while (true) {
                try {
                    yield this.peerRouting.findPeer(pid);
                    break;
                }
                catch (e) {
                    this.logger.error(e);
                    yield new Promise((resolve) => setTimeout(resolve, 3000));
                }
            }
            this.emit("badswap/trade/peer", 0); // start finding peer's orders
            const { stream } = yield this.dialProtocol(pid, "/badswap/0.1.0/userdata");
            this.emit("badswap/trade/peer", 1); // peer found
            const decoded = (0, it_pipe_1.pipe)(stream.source, lp.decode());
            const { value: userDataBufferList } = yield decoded.next();
            const result = userDataBufferList.slice();
            this.emit("badswap/trade/peer", 2); // got offers
            const userData = this._decodeUserData(result);
            this.emit("badswap/trade/peer", 3); // offers decoded and returning
            return userData;
        });
    }
    // Takes in a peerId and returns a list of exisiting trades
    getTradesByPeerId(peerId) {
        return __awaiter(this, void 0, void 0, function* () {
            let pid = peer_id_1.default.createFromB58String(peerId);
            while (true) {
                try {
                    yield this.peerRouting.findPeer(pid);
                    break;
                }
                catch (e) {
                    this.logger.error(e);
                    yield new Promise((resolve) => setTimeout(resolve, 3000));
                }
            }
            this.emit("badswap/trade/peer", 0); // start finding peer's orders
            const { stream } = yield this.dialProtocol(pid, "/badswap/0.1.0/orders");
            this.emit("badswap/trade/peer", 1); // peer found
            const decoded = (0, it_pipe_1.pipe)(stream.source, lp.decode());
            const { value: offerListBufferList } = yield decoded.next();
            const result = offerListBufferList.slice();
            this.emit("badswap/trade/peer", 2); // got offers
            const offerList = this._decodeOffers(result);
            this.emit("badswap/trade/peer", 3); // offers decoded and returning
            return offerList;
        });
    }
    _decodeOffers(data) {
        let offerList = protocol_1.protocol.OfferList.toObject(protocol_1.protocol.OfferList.decode(data), {
            enums: String,
            longs: String,
            bytes: String,
            defaults: true,
            arrays: true,
            objects: true,
            oneofs: true,
        });
        const offers = (0, exports.protobufOffersToHex)(offerList.offers);
        return Object.assign(offerList, { offers });
    }
    _decodeUserData(data) {
        let userData = protocol_1.protocol.UserData.toObject(protocol_1.protocol.UserData.decode(data), {
            enums: String,
            longs: String,
            bytes: String,
            defaults: true,
            arrays: true,
            objects: true,
            oneofs: true,
        });
        const offers = (0, exports.protobufOffersToHex)(userData.offers);
        return {
            offers,
            image: Buffer.from(ethers_1.ethers.decodeBase64(userData.image)),
            bio: userData.bio,
        };
    }
    getTradeAddress(sharedAddress) {
        return __awaiter(this, void 0, void 0, function* () {
            const address = getCreateAddress({
                nonce: yield this.signer.provider.getTransactionCount(sharedAddress),
                from: sharedAddress,
            });
            this.logger.debug("TRADE ADDRESS: " + address);
            return address;
        });
    }
    approveTrade(transfer, sharedAddress) {
        return __awaiter(this, void 0, void 0, function* () {
            const tradeAddress = yield this.getTradeAddress(sharedAddress);
            if ((0, trade_2.isERC721Transfer)(transfer) || (0, trade_2.isERC1155Transfer)(transfer)) {
                if (yield (0, detect_erc721_permit_1.detectERC721Permit)(transfer.token, this.signer)) {
                    const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
                    const permitData = yield erc721Permit.signAndMergeERC721({
                        asset: transfer.token,
                        tokenId: transfer.tokenId,
                        spender: tradeAddress,
                        owner: yield this.signer.getAddress(),
                        expiry,
                    }, this.signer);
                    return {
                        permitData,
                        wait() {
                            return __awaiter(this, void 0, void 0, function* () {
                                return {};
                            });
                        },
                    };
                }
                const token = new Contract(transfer.token, [
                    "function setApprovalForAll(address, bool)",
                    "function isApprovedForAll(address, address) view returns (bool)",
                ], this.signer);
                if (!(yield token.isApprovedForAll(yield this.signer.getAddress(), tradeAddress))) {
                    return yield token.setApprovalForAll(tradeAddress, true);
                }
                return {
                    wait() {
                        return __awaiter(this, void 0, void 0, function* () {
                            return {};
                        });
                    },
                };
            }
            const token = new Contract(yield (0, trade_2.coerceToWeth)(ethers_1.ethers.getAddress(transfer.token), this.signer), trade_2.genericAbi, this.signer);
            this.logger.debug("ADDRESS", yield this.signer.getAddress());
            this.logger.debug("BALANCE BEFORE APPROVING " +
                ethers_1.ethers.formatEther(yield token.balanceOf(yield this.signer.getAddress())));
            if (transfer.token === ethers_1.ethers.ZeroAddress) {
                const { chainId } = yield this.signer.provider.getNetwork();
                const weth = new ethers_1.ethers.Contract((0, trade_1.toWETH)(Number(chainId)), [
                    "function deposit()",
                    "function balanceOf(address) view returns (uint256)",
                ], this.signer);
                const wethBalance = ethers_1.ethers.toBigInt(yield weth.balanceOf(yield this.signer.getAddress()));
                if (wethBalance < ethers_1.ethers.toBigInt(transfer.amount)) {
                    const depositTx = yield weth.deposit({ value: ethers_1.ethers.toBigInt(transfer.amount) - wethBalance });
                    if (this._awaitReceipts)
                        yield this.signer.provider.waitForTransaction(depositTx.hash);
                }
                this.logger.debug("WETH BALANCE " +
                    ethers_1.ethers.formatEther(yield weth.balanceOf(yield this.signer.getAddress())));
            }
            if (yield (0, detect_permit_1.detectPermit)(transfer.token, this.signer)) {
                const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
                const permitData = yield permit.sign({
                    asset: transfer.token,
                    value: transfer.amount,
                    spender: tradeAddress,
                    owner: yield this.signer.getAddress(),
                    expiry,
                }, this.signer);
                return {
                    permitData,
                    wait() {
                        return __awaiter(this, void 0, void 0, function* () {
                            return {};
                        });
                    },
                };
            }
            else if (Number((yield this.signer.provider.getNetwork()).chainId) === 1) {
                const tx = yield this.approvePermit2(transfer.token);
                if (tx && this._awaitReceipts)
                    yield this.signer.provider.waitForTransaction(tx.hash);
                const signatureTransfer = {
                    permit: {
                        permitted: {
                            token: yield (0, trade_2.coerceToWeth)(transfer.token, this.signer),
                            amount: transfer.amount,
                        },
                        spender: tradeAddress,
                        nonce: ethers_1.ethers.hexlify(ethers_1.ethers.toBeArray(ethers_1.ethers.getUint(Math.floor(Date.now() / 1000)))),
                        deadline: ethers_1.ethers.hexlify(ethers_1.ethers.toBeArray(ethers_1.ethers.getUint(Math.floor(Date.now() / 1000)) +
                            BigInt(60 * 60 * 24))),
                    },
                    permit2Address: permit2_sdk_1.PERMIT2_ADDRESS,
                    chainId: 1,
                };
                const signature = yield signTypedData(this.signer, ...getPermitData(signatureTransfer));
                return {
                    permitData: {
                        signatureTransfer: signatureTransfer.permit,
                        signature,
                    },
                    wait() {
                        return __awaiter(this, void 0, void 0, function* () {
                            return {};
                        });
                    },
                };
            }
            else {
                const tx = yield token.approve(tradeAddress, transfer.amount);
                this.logger.debug("TRADE ADDRESS", tradeAddress);
                this.logger.debug("BALANCE AFTER APPROVING " +
                    ethers_1.ethers.formatEther(yield token.balanceOf(yield this.signer.getAddress())));
                this.logger.debug("ALLOWANCE AFTER APPROVING " +
                    ethers_1.ethers.formatEther(yield token.allowance(yield this.signer.getAddress(), tradeAddress)));
                return tx;
            }
        });
    }
    approvePermit2(asset) {
        return __awaiter(this, void 0, void 0, function* () {
            const token = new Contract(yield (0, trade_2.coerceToWeth)(asset, this.signer), trade_2.genericAbi, this.signer);
            const allowance = yield token.allowance(yield this.signer.getAddress(), permit2_sdk_1.PERMIT2_ADDRESS);
            if (ethers_1.ethers.getUint(allowance) < ethers_1.ethers.getUint("0x0" + "f".repeat(63))) {
                return yield token.approve(permit2_sdk_1.PERMIT2_ADDRESS, ethers_1.ethers.MaxUint256);
            }
            return null;
        });
    }
    prepareTransaction(offer, maker, taker, permitData) {
        return __awaiter(this, void 0, void 0, function* () {
            const contract = (0, trade_2.createContract)(offer.gives, Math.floor(Date.now() / 1000) + 60 * 60 * 24, ethers_1.ethers.hexlify((0, random_bytes_1.sync)(32)), maker, taker, (yield this.signer.getNetwork()).chainId, permitData);
            return contract;
        });
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
        trade.hashes = batchFill.map((v) => (0, trade_2.hashOffer)(v.offer));
        this.emit("trade:taker", trade);
        (() => __awaiter(this, void 0, void 0, function* () { }))().catch((err) => trade.reject(err));
        return trade;
    }
}
exports.Badswap = Badswap;
//# sourceMappingURL=badswap.js.map