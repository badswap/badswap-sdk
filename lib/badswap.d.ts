/// <reference types="node" />
/// <reference types="node" />
import { BadP2P } from "./p2p";
import { BigNumberish } from "ethers";
import { EventEmitter } from "events";
import { defer } from "./trade";
import PeerId from "peer-id";
import { createLogger } from "./logger";
export declare const protobufOffersToHex: (offers: any) => any;
export declare function sendFlashbotsTransaction(data: any): Promise<any>;
export declare class BadswapTrade extends EventEmitter {
    hashes: null | string[];
    _deferred: ReturnType<typeof defer>;
    constructor();
    toPromise(): Promise<unknown>;
    resolve(v?: any): void;
    reject(err: any): void;
}
export declare function encodeBatchFill(o: any): any;
export declare function decodeBatchFill(data: any): any;
export declare function scaleOffer(offer: any, amount: BigNumberish): any;
export declare function toBigIntFromBytes(b: any): bigint;
export declare function sumOffers(offers: any[]): any;
export declare const NS_MULTIADDRS: {
    BREAD: string[];
};
export interface IUserData {
    bio: string;
    image: Buffer;
}
export declare class Badswap extends BadP2P {
    signer: any;
    offers: Map<string, any>;
    logger: ReturnType<typeof createLogger>;
    peers: Map<string, [string, any]>;
    userData: IUserData;
    _awaitReceipts: boolean;
    static initialize({ awaitReceipts, signer }: {
        awaitReceipts: any;
        signer: any;
    }): Promise<Badswap>;
    resolveName(name: any): Promise<string>;
    registerName(name: any): Promise<unknown>;
    constructor({ awaitReceipts, signer, peerId, userData, offers }: any);
    setBio(s: string): void;
    setImage(b: Buffer): void;
    publishOffers(): Promise<void>;
    startPublishingOffers(ms: number): {
        setInterval(_ms: any): void;
        stop(): void;
    };
    subscribeOffers(): Promise<void>;
    startNode(): Promise<void>;
    stopNode(): Promise<void>;
    toObject(): {
        peerId: PeerId.JSONPeerId;
        userData: {
            bio: string;
            image: string;
        };
        offers: any[];
    };
    static fromObject(o: any, signer: any): Promise<Badswap>;
    _encodeOffers(): any;
    _encodeUserData(): any;
    handleUserData(): Promise<void>;
    handleBroadcastedOffers(): Promise<void>;
    broadcastOffer(_offer: any): void;
    getUserDataByPeerId(peerId: string): Promise<{
        offers: any;
        image: Buffer;
        bio: any;
    }>;
    getTradesByPeerId(peerId: string): Promise<any>;
    _decodeOffers(data: Buffer): any;
    _decodeUserData(data: Buffer): {
        offers: any;
        image: Buffer;
        bio: any;
    };
    getTradeAddress(sharedAddress: string): Promise<string>;
    approveTrade(transfer: any, sharedAddress: string): Promise<any>;
    approvePermit2(asset: string): Promise<any>;
    prepareTransaction(offer: any, maker: string, taker: string, permitData: any): Promise<any>;
    createTrade(peer: any, offer: any): BadswapTrade;
    createBatchTrade(peer: any, batchFill: any): BadswapTrade;
}
