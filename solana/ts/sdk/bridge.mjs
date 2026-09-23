// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Public operation identity only. Native chain observations determine amount.
import {base58Decode,base58Encode} from '../../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs';
export function publicKey(value) {
  if(typeof value!=='string'||value.length<32||value.length>44)throw new Error('BridgeDestinationRejected');
  const bytes=Buffer.from(base58Decode(value));
  if(bytes.length!==32||base58Encode(bytes)!==value)throw new Error('BridgeDestinationRejected');
  return bytes;
}
export function createBurnOperationRequest(input) {
  if(!input||Object.keys(input).sort().join()!=='clientNonce,destination,walletChain'||
    !['solana:devnet','solana:localnet'].includes(input.walletChain)||
    typeof input.clientNonce!=='string'||!/^[0-9a-f]{64}$/u.test(input.clientNonce)||/^0+$/u.test(input.clientNonce))
    throw new Error('BridgeOperationFieldsRejected');
  publicKey(input.destination);
  return Object.freeze({...input});
}
