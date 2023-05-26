import protobuf from 'protobufjs';
import api from './badswap-protocol.json';

const protocol = (protobuf.Root as any).fromJSON(api).nested.badswap;

export { protocol }
