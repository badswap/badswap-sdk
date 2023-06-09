"use strict";
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
exports.createContract = exports.replaceForAddressOpcode = exports.numberToHex = exports.erc1155Interface = exports.tokenInterface = exports.stripHexPrefix = exports.addHexPrefix = exports.hashOffer = exports.offerToProtobufStruct = exports.isCryptoOffer = exports.isFiatOffer = exports.toWETH = exports.coerceToWeth = exports.setFallbackWETH = exports.WETH_ADDRESSES = exports.transactionToObject = exports.defer = exports.genericAbi = exports.leftZeroPad = exports.isERC1155Transfer = exports.isERC721Transfer = exports.isERC20Transfer = exports.keyshareToAddress = exports.toBigInt = exports.erc721PermitInterface = exports.permit2Interface = void 0;
const ethers_1 = require("ethers");
const emasm_1 = require("emasm");
const bn_js_1 = __importDefault(require("bn.js"));
const WETH9_json_1 = __importDefault(require("canonical-weth/build/contracts/WETH9.json"));
const permit2_sdk_1 = require("@uniswap/permit2-sdk");
const permit2_json_1 = __importDefault(require("@pintswap/sdk/lib/permit2.json"));
const { solidityPackedKeccak256, toBeArray, getAddress, computeAddress, getUint, hexlify, } = ethers_1.ethers;
exports.permit2Interface = new ethers_1.ethers.Interface(permit2_json_1.default);
exports.erc721PermitInterface = new ethers_1.ethers.Interface([
    "function permit(address, uint256, uint256, uint8, bytes32, bytes32)",
]);
// UTILS
function toBigInt(v) {
    if (v.toHexString)
        return v.toBigInt();
    return v;
}
exports.toBigInt = toBigInt;
function keyshareToAddress(keyshareJsonObject) {
    let { Q } = keyshareJsonObject;
    let prepend = new bn_js_1.default(Q.y, 16).mod(new bn_js_1.default(2)).isZero() ? "0x02" : "0x03";
    let derivedPubKey = prepend + leftZeroPad(new bn_js_1.default(Q.x, 16).toString(16), 64);
    return computeAddress(derivedPubKey);
}
exports.keyshareToAddress = keyshareToAddress;
const isERC20Transfer = (o) => !o.tokenId;
exports.isERC20Transfer = isERC20Transfer;
const isERC721Transfer = (o) => Boolean(o.tokenId && o.token && o.amount === undefined);
exports.isERC721Transfer = isERC721Transfer;
const isERC1155Transfer = (o) => Boolean(o.tokenId && o.token && o.amount !== undefined);
exports.isERC1155Transfer = isERC1155Transfer;
function leftZeroPad(s, n) {
    return "0".repeat(n - s.length) + s;
}
exports.leftZeroPad = leftZeroPad;
exports.genericAbi = [
    "function approve(address, uint256) returns (bool)",
    "function allowance(address, address) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
];
const defer = () => {
    let resolve, reject, promise = new Promise((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
    });
    return {
        resolve,
        reject,
        promise,
    };
};
exports.defer = defer;
const transactionToObject = (tx) => ({
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
exports.transactionToObject = transactionToObject;
// ETH/WETH
exports.WETH_ADDRESSES = Object.assign(Object.entries(WETH9_json_1.default.networks).reduce((r, [chainId, { address }]) => {
    r[chainId] = address;
    return r;
}, {}), {
    "42161": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    "137": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    "10": "0x4200000000000000000000000000000000000006",
    "43112": "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB",
    "324": "0x8Ebe4A94740515945ad826238Fc4D56c6B8b0e60",
});
let fallbackWETH = null;
const setFallbackWETH = (address) => {
    fallbackWETH = address;
};
exports.setFallbackWETH = setFallbackWETH;
const coerceToWeth = (address, signer) => __awaiter(void 0, void 0, void 0, function* () {
    if (address === ethers_1.ethers.ZeroAddress) {
        const { chainId } = yield signer.provider.getNetwork();
        return (0, exports.toWETH)(chainId);
    }
    return address;
});
exports.coerceToWeth = coerceToWeth;
const toWETH = (chainId = 1) => {
    const chain = String(chainId);
    const address = exports.WETH_ADDRESSES[chain];
    return (address ||
        fallbackWETH ||
        (() => {
            throw Error("no WETH contract found for chainid " + chain);
        })());
};
exports.toWETH = toWETH;
const isFiatOffer = (offer) => {
    return Boolean(offer.backend);
};
exports.isFiatOffer = isFiatOffer;
const isCryptoOffer = (offer) => {
    return offer && !(0, exports.isFiatOffer)(offer);
};
exports.isCryptoOffer = isCryptoOffer;
const offerToProtobufStruct = (offer) => {
    return (0, exports.isFiatOffer)(offer)
        ? {
            fiat: offer,
        }
        : {
            crypto: offer,
        };
};
exports.offerToProtobufStruct = offerToProtobufStruct;
const hashOffer = (offer) => {
    if ((0, exports.isFiatOffer)(offer)) {
        return solidityPackedKeccak256(["address", "uint256", "uint256", "uint256"], [offer.token, offer.amount, offer.chainId, offer.price]);
    }
    else {
        return solidityPackedKeccak256(["uint256", "uint256", "uint256"], [offer.backend, offer.availableVolume, offer.price]);
    }
};
exports.hashOffer = hashOffer;
const addHexPrefix = (s) => (s.substr(0, 2) === "0x" ? s : "0x" + s);
exports.addHexPrefix = addHexPrefix;
const stripHexPrefix = (s) => s.substr(0, 2) === "0x" ? s.substr(2) : s;
exports.stripHexPrefix = stripHexPrefix;
exports.tokenInterface = new ethers_1.ethers.Interface([
    "function transferFrom(address, address, uint256) returns (bool)",
    "function safeTransferFrom(address, address, uint256)",
    "function permit(address, address, uint256, uint256, uint8, bytes32, bytes32)",
    "function withdraw(uint256)",
]);
exports.erc1155Interface = new ethers_1.ethers.Interface([
    "function safeTransferFrom(address, address, uint256, uint256)",
]);
const numberToHex = (v) => hexlify(toBeArray(getUint(v)));
exports.numberToHex = numberToHex;
const replaceForAddressOpcode = (calldata) => {
    return [].slice
        .call((0, exports.stripHexPrefix)(calldata).replace(/[0]{24}[1]{40}/g, "-"))
        .reduce((r, v) => {
        if (v === "-") {
            r.push(["address"]);
            r.push([]);
        }
        else
            r[r.length - 1].push(v);
        return r;
    }, [[]])
        .map((v) => (v.length === 1 ? v : (0, exports.addHexPrefix)(v.join(""))));
};
exports.replaceForAddressOpcode = replaceForAddressOpcode;
// SWAP CONTRACT
const createContract = (offer, expiration, secret, maker, taker, chainId = 1, permitData = {}) => {
    let firstInstruction = true;
    let beforeCall = true;
    const zero = () => {
        if (firstInstruction) {
            firstInstruction = false;
            return "pc";
        }
        else if (beforeCall) {
            return "returndatasize";
        }
        else
            return "0x0";
    };
    const makeMstoreInstructions = (words, offset = "0x0") => {
        return words.reduce((r, v) => {
            r.push(ethers_1.ethers.stripZerosLeft((0, exports.addHexPrefix)(v)));
            r.push(offset);
            r.push("mstore");
            offset = (0, exports.numberToHex)(Number(offset) + 0x20);
            return r;
        }, []);
    };
    const call = (address, calldata, value) => {
        const calldataSubstituted = (0, exports.replaceForAddressOpcode)(calldata);
        const stripped = calldataSubstituted.map((v) => typeof v === "string" ? (0, exports.stripHexPrefix)(v) : v);
        const inputLength = ((v) => (v === "0x" ? "0x0" : v))((0, exports.numberToHex)(stripped.reduce((r, v) => r + (typeof v === "string" ? v.length / 2 : 0x20), 0)));
        const first = stripped[0];
        const initial = [];
        let offset = "0x0";
        let wordSize = "0x20";
        if (!Array.isArray(first)) {
            if (first) {
                initial.push(ethers_1.ethers.zeroPadBytes((0, exports.addHexPrefix)(first.substr(0, 8)), 0x20));
                initial.push("0x0");
                initial.push("mstore");
                offset = "0x4";
            }
        }
        if (stripped[0])
            stripped[0] = stripped[0].substr(8);
        const mstoreInstructions = initial.concat(stripped.map((v) => {
            if (!v.length)
                return [];
            if (Array.isArray(v)) {
                wordSize = "0x20";
                const list = [v, offset, "mstore"];
                offset = (0, exports.numberToHex)(Number(offset) + 0x20);
                return list;
            }
            const words = v.match(/.{1,64}/g);
            const list = makeMstoreInstructions(words, offset);
            offset = (0, exports.numberToHex)(Number(offset) + v.length / 2);
            return list;
        }));
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
        if ((0, exports.isERC20Transfer)(transfer)) {
            return call(transfer.token, exports.tokenInterface.encodeFunctionData("permit", [
                owner,
                "0x" + "1".repeat(40),
                transfer.amount,
                (0, exports.numberToHex)(permitData.expiry),
                (0, exports.numberToHex)(permitData.v),
                permitData.r,
                permitData.s,
            ]));
        }
        else if ((0, exports.isERC721Transfer)(transfer)) {
            return call(transfer.token, exports.erc721PermitInterface.encodeFunctionData("permit", [
                "0x" + "1".repeat(40),
                transfer.tokenId,
                permitData.expiry,
                permitData.v,
                permitData.r,
                permitData.s,
            ]));
        }
        else
            return [];
    };
    const transfer = (transfer, to) => {
        if (transfer.token !== ethers_1.ethers.ZeroAddress)
            return call(transfer.token, exports.tokenInterface.encodeFunctionData("transfer", [to, transfer.amount]), "0x0");
        else
            return call(to, "0x", transfer.amount);
    };
    const transferFrom = (transfer, from, to, permitData) => {
        if ((0, exports.isERC20Transfer)(transfer)) {
            if (permitData && permitData.signatureTransfer) {
                if (transfer.token === ethers_1.ethers.ZeroAddress) {
                    return [
                        call(permit2_sdk_1.PERMIT2_ADDRESS, exports.permit2Interface.encodeFunctionData("permitTransferFrom", [
                            {
                                permitted: {
                                    token: (0, exports.toWETH)(chainId),
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
                        ])),
                        call((0, exports.toWETH)(chainId), exports.tokenInterface.encodeFunctionData("withdraw", [transfer.amount])),
                        call(to, "0x", transfer.amount),
                    ];
                }
                return call(permit2_sdk_1.PERMIT2_ADDRESS, exports.permit2Interface.encodeFunctionData("permitTransferFrom", [
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
                ]));
            }
            if (transfer.token === ethers_1.ethers.ZeroAddress) {
                return [
                    call((0, exports.toWETH)(chainId), exports.tokenInterface.encodeFunctionData("transferFrom", [
                        from,
                        "0x" + "1".repeat(40),
                        transfer.amount,
                    ])),
                    call(to, "0x", transfer.amount),
                ];
            }
            return call(transfer.token, exports.tokenInterface.encodeFunctionData("transferFrom", [
                from,
                to,
                transfer.amount,
            ]));
        }
        else if ((0, exports.isERC721Transfer)(transfer)) {
            return call(transfer.token, exports.tokenInterface.encodeFunctionData("safeTransferFrom", [
                from,
                to,
                transfer.tokenId,
            ]));
        }
        else if ((0, exports.isERC1155Transfer)(transfer)) {
            return call(transfer.token, exports.erc1155Interface.encodeFunctionData("safeTransferFrom", [
                from,
                to,
                transfer.tokenId,
                transfer.amount,
            ]));
        }
    };
    return (0, emasm_1.emasm)([
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
                (0, emasm_1.emasm)([
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
exports.createContract = createContract;
//# sourceMappingURL=trade.js.map