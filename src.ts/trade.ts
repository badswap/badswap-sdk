import { BigNumberish, ethers, Signer } from "ethers";
import { emasm } from "emasm";
import BN from "bn.js";
import WETH9 from "canonical-weth/build/contracts/WETH9.json";
import { PERMIT2_ADDRESS } from "@uniswap/permit2-sdk";
import Permit2ABI from "@pintswap/sdk/lib/permit2.json";
const {
  solidityPackedKeccak256,
  toBeArray,
  getAddress,
  computeAddress,
  getUint,
  hexlify,
} = ethers;

export const permit2Interface = new ethers.Interface(Permit2ABI);

export const erc721PermitInterface = new ethers.Interface([
  "function permit(address, uint256, uint256, uint8, bytes32, bytes32)",
]);

// UTILS
export function toBigInt(v) {
  if (v.toHexString) return v.toBigInt();
  return v;
}

export function keyshareToAddress(keyshareJsonObject) {
  let { Q } = keyshareJsonObject as any;
  let prepend = new BN(Q.y, 16).mod(new BN(2)).isZero() ? "0x02" : "0x03";
  let derivedPubKey = prepend + leftZeroPad(new BN(Q.x, 16).toString(16), 64);
  return computeAddress(derivedPubKey as string);
}

export const isERC20Transfer = (o) => !o.tokenId;

export const isERC721Transfer = (o) =>
  Boolean(o.tokenId && o.token && o.amount === undefined);

export const isERC1155Transfer = (o) =>
  Boolean(o.tokenId && o.token && o.amount !== undefined);

export function leftZeroPad(s, n) {
  return "0".repeat(n - s.length) + s;
}

export const genericAbi = [
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

export const defer = () => {
  let resolve,
    reject,
    promise = new Promise((_resolve, _reject) => {
      resolve = _resolve;
      reject = _reject;
    });
  return {
    resolve,
    reject,
    promise,
  };
};

export const transactionToObject = (tx) => ({
  nonce: tx.nonce,
  value: tx.value,
  from: tx.from,
  gasPrice: tx.gasPrice,
  gasLimit: tx.gasLimit,
  chainId: tx.chainId,
  data: tx.data,
  maxFeePerGas: tx.maxFeePerGas,
  maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
});

// ETH/WETH
export const WETH_ADDRESSES = Object.assign(
  Object.entries(WETH9.networks).reduce((r, [chainId, { address }]: any) => {
    r[chainId] = address;
    return r;
  }, {}),
  {
    "42161": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    "137": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    "10": "0x4200000000000000000000000000000000000006",
    "43112": "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB",
    "324": "0x8Ebe4A94740515945ad826238Fc4D56c6B8b0e60",
  }
);

let fallbackWETH = null;
export const setFallbackWETH = (address) => {
  fallbackWETH = address;
};

export const coerceToWeth = async (address, signer) => {
  if (address === ethers.ZeroAddress) {
    const { chainId } = await signer.provider.getNetwork();
    return toWETH(chainId);
  }
  return address;
};

export const toWETH = (chainId: number | string = 1) => {
  const chain = String(chainId);
  const address = WETH_ADDRESSES[chain];
  return (
    address ||
    fallbackWETH ||
    (() => {
      throw Error("no WETH contract found for chainid " + chain);
    })()
  );
};

export const isFiatOffer = (offer) => {
  return Boolean(offer.backend);
};

export const isCryptoOffer = (offer) => {
  return offer && !isFiatOffer(offer);
};

export const offerToProtobufStruct = (offer) => {
  return isFiatOffer(offer)
    ? {
        fiat: offer,
      }
    : {
        crypto: offer,
      };
};

export const hashOffer = (offer) => {
  if (isFiatOffer(offer)) {
    return solidityPackedKeccak256(
      ["address", "uint256", "uint256", "uint256"],
      [offer.token, offer.amount, offer.chainId, offer.price]
    );
  } else {
    return solidityPackedKeccak256(
      ["uint256", "uint256", "uint256"],
      [offer.backend, offer.availableVolume, offer.price]
    );
  }
};

export const addHexPrefix = (s) => (s.substr(0, 2) === "0x" ? s : "0x" + s);
export const stripHexPrefix = (s) =>
  s.substr(0, 2) === "0x" ? s.substr(2) : s;

export const tokenInterface = new ethers.Interface([
  "function transferFrom(address, address, uint256) returns (bool)",
  "function safeTransferFrom(address, address, uint256)",
  "function permit(address, address, uint256, uint256, uint8, bytes32, bytes32)",
  "function withdraw(uint256)",
]);

export const erc1155Interface = new ethers.Interface([
  "function safeTransferFrom(address, address, uint256, uint256)",
]);

export const numberToHex = (v) => hexlify(toBeArray(getUint(v)));

export const replaceForAddressOpcode = (calldata) => {
  return [].slice
    .call(stripHexPrefix(calldata).replace(/[0]{24}[1]{40}/g, "-"))
    .reduce(
      (r, v) => {
        if (v === "-") {
          r.push(["address"]);
          r.push([]);
        } else r[r.length - 1].push(v);
        return r;
      },
      [[]]
    )
    .map((v) => (v.length === 1 ? v : addHexPrefix(v.join(""))));
};

// SWAP CONTRACT
export const createContract = (
  offer: any,
  expiration: number,
  secret: string,
  maker: string,
  taker: string,
  chainId: string | number = 1,
  permitData: any = {}
) => {
  let firstInstruction = true;
  let beforeCall = true;
  const zero = () => {
    if (firstInstruction) {
      firstInstruction = false;
      return "pc";
    } else if (beforeCall) {
      return "returndatasize";
    } else return "0x0";
  };
  const makeMstoreInstructions = (words, offset = "0x0") => {
    return words.reduce((r, v) => {
      r.push(ethers.stripZerosLeft(addHexPrefix(v)));
      r.push(offset);
      r.push("mstore");
      offset = numberToHex(Number(offset) + 0x20);
      return r;
    }, []);
  };
  const call = (address, calldata, value?) => {
    const calldataSubstituted = replaceForAddressOpcode(calldata);
    const stripped = calldataSubstituted.map((v) =>
      typeof v === "string" ? stripHexPrefix(v) : v
    );
    const inputLength = ((v) => (v === "0x" ? "0x0" : v))(
      numberToHex(
        stripped.reduce(
          (r, v) => r + (typeof v === "string" ? v.length / 2 : 0x20),
          0
        )
      )
    );
    const first = stripped[0];
    const initial = [];
    let offset = "0x0";
    let wordSize = "0x20";
    if (!Array.isArray(first)) {
      if (first) {
        initial.push(
          ethers.zeroPadBytes(addHexPrefix(first.substr(0, 8)), 0x20)
        );
        initial.push("0x0");
        initial.push("mstore");
        offset = "0x4";
      }
    }
    if (stripped[0]) stripped[0] = stripped[0].substr(8);
    const mstoreInstructions = initial.concat(
      stripped.map((v) => {
        if (!v.length) return [];
        if (Array.isArray(v)) {
          wordSize = "0x20";
          const list = [v, offset, "mstore"];
          offset = numberToHex(Number(offset) + 0x20);
          return list;
        }
        const words = v.match(/.{1,64}/g);
        const list = makeMstoreInstructions(words, offset);
        offset = numberToHex(Number(offset) + v.length / 2);
        return list;
      })
    );

    const instructions = [
      zero(),
      zero(),
      inputLength,
      zero(),
      value || zero(),
      getAddress(address),
      "gas",
      calldata === "0x" ? [] : mstoreInstructions,
      "call",
      beforeCall ? [] : ["and"],
    ];
    beforeCall = false;
    return instructions;
  };
  permitData = permitData || {};
  const permit = (transfer, owner, permitData) => {
    if (isERC20Transfer(transfer)) {
      return call(
        transfer.token,
        tokenInterface.encodeFunctionData("permit", [
          owner,
          "0x" + "1".repeat(40),
          transfer.amount,
          numberToHex(permitData.expiry),
          numberToHex(permitData.v),
          permitData.r,
          permitData.s,
        ])
      );
    } else if (isERC721Transfer(transfer)) {
      return call(
        transfer.token,
        erc721PermitInterface.encodeFunctionData("permit", [
          "0x" + "1".repeat(40),
          transfer.tokenId,
          permitData.expiry,
          permitData.v,
          permitData.r,
          permitData.s,
        ])
      );
    } else return [];
  };
  const transfer = (transfer, to) => {
    if (transfer.token !== ethers.ZeroAddress)
      return call(
        transfer.token,
        tokenInterface.encodeFunctionData("transfer", [to, transfer.amount]),
        "0x0"
      );
    else return call(to, "0x", transfer.amount);
  };
  const transferFrom = (transfer, from, to, permitData) => {
    if (isERC20Transfer(transfer)) {
      if (permitData && permitData.signatureTransfer) {
        if (transfer.token === ethers.ZeroAddress) {
          return [
            call(
              PERMIT2_ADDRESS,
              permit2Interface.encodeFunctionData("permitTransferFrom", [
                {
                  permitted: {
                    token: toWETH(chainId),
                    amount: transfer.amount,
                  },
                  nonce: permitData.signatureTransfer.nonce,
                  deadline: permitData.signatureTransfer.deadline,
                },
                {
                  to: "0x" + "1".repeat(40),
                  requestedAmount: transfer.amount,
                },
                from,
                permitData.signature,
              ])
            ),
            call(
              toWETH(chainId),
              tokenInterface.encodeFunctionData("withdraw", [transfer.amount])
            ),
            call(to, "0x", transfer.amount),
          ];
        }
        return call(
          PERMIT2_ADDRESS,
          permit2Interface.encodeFunctionData("permitTransferFrom", [
            {
              permitted: {
                token: transfer.token,
                amount: transfer.amount,
              },
              nonce: permitData.signatureTransfer.nonce,
              deadline: permitData.signatureTransfer.deadline,
            },
            {
              to,
              requestedAmount: transfer.amount,
            },
            from,
            permitData.signature,
          ])
        );
      }
      if (transfer.token === ethers.ZeroAddress) {
        return [
          call(
            toWETH(chainId),
            tokenInterface.encodeFunctionData("transferFrom", [
              from,
              "0x" + "1".repeat(40),
              transfer.amount,
            ])
          ),
          call(to, "0x", transfer.amount),
        ];
      }
      return call(
        transfer.token,
        tokenInterface.encodeFunctionData("transferFrom", [
          from,
          to,
          transfer.amount,
        ])
      );
    } else if (isERC721Transfer(transfer)) {
      return call(
        transfer.token,
        tokenInterface.encodeFunctionData("safeTransferFrom", [
          from,
          to,
          transfer.tokenId,
        ])
      );
    } else if (isERC1155Transfer(transfer)) {
      return call(
        transfer.token,
        erc1155Interface.encodeFunctionData("safeTransferFrom", [
          from,
          to,
          transfer.tokenId,
          transfer.amount,
        ])
      );
    }
  };
  return emasm([
    (permitData && permitData.v && permit(offer, maker, permitData)) || [],
    transferFrom(offer, maker, "0x" + "1".repeat(40), permitData),
    ["iszero", "failure", "jumpi"],
    [
      "bytes:runtime:len",
      "bytes:runtime:ptr",
      "0x0",
      "calldatacopy",
      "bytes:runtime:len",
      "0x0",
      "return",
    ],
    [
      "failure",
      [
        "returndatasize",
        "0x0",
        "dup1",
        "returndatacopy",
        "returndatasize",
        "0x0",
        "revert",
      ],
    ],
    [
      "bytes:runtime",
      [
        emasm([
          [
            "caller",
            maker,
            "eq",
            expiration,
            "timestamp",
            "gt",
            "and",
            "refund",
            "jumpi",
            "calldatasize",
            "returndatasize",
            "dup1",
            "calldatacopy",
            "calldatasize",
            "returndatasize",
            "keccak256",
            secret,
            "eq",
            "revealsuccess",
            "jumpi",
            "0x0",
            "0x0",
            "revert",
            ["revealsuccess", [transfer(offer, taker), taker, "selfdestruct"]],
            ["refund", [transfer(offer, maker), maker, "selfdestruct"]],
          ],
        ]),
      ],
    ],
  ]);
};
