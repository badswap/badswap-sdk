import { ethers } from "ethers";
export declare const permit2Interface: ethers.Interface;
export declare const erc721PermitInterface: ethers.Interface;
export declare function toBigInt(v: any): any;
export declare function keyshareToAddress(keyshareJsonObject: any): string;
export declare const isERC20Transfer: (o: any) => boolean;
export declare const isERC721Transfer: (o: any) => boolean;
export declare const isERC1155Transfer: (o: any) => boolean;
export declare function leftZeroPad(s: any, n: any): string;
export declare const genericAbi: string[];
export declare const defer: () => {
    resolve: any;
    reject: any;
    promise: Promise<unknown>;
};
export declare const transactionToObject: (tx: any) => {
    nonce: any;
    value: any;
    from: any;
    gasPrice: any;
    gasLimit: any;
    chainId: any;
    data: any;
    maxFeePerGas: any;
    maxPriorityFeePerGas: any;
};
export declare const WETH_ADDRESSES: {
    "42161": string;
    "137": string;
    "10": string;
    "43112": string;
    "324": string;
};
export declare const setFallbackWETH: (address: any) => void;
export declare const coerceToWeth: (address: any, signer: any) => Promise<any>;
export declare const toWETH: (chainId?: number | string) => any;
export declare const isFiatOffer: (offer: any) => boolean;
export declare const isCryptoOffer: (offer: any) => boolean;
export declare const offerToProtobufStruct: (offer: any) => {
    fiat: any;
    crypto?: undefined;
} | {
    crypto: any;
    fiat?: undefined;
};
export declare const hashOffer: (offer: any) => string;
export declare const addHexPrefix: (s: any) => any;
export declare const stripHexPrefix: (s: any) => any;
export declare const tokenInterface: ethers.Interface;
export declare const erc1155Interface: ethers.Interface;
export declare const numberToHex: (v: any) => string;
export declare const replaceForAddressOpcode: (calldata: any) => any;
export declare const createContract: (offer: any, expiration: number, secret: string, maker: string, taker: string, chainId?: string | number, permitData?: any) => any;
