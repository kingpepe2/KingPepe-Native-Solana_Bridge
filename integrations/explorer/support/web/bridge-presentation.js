// Presentation only. Progress follows independently verified journal state.
export const FORWARD_STEPS = Object.freeze(['Deposit','Confirmed','Burn','Burn Finality','Attested','Minted','Completed']);
const positions = {DEPOSIT_ADDRESS_ISSUED:0,DEPOSIT_OBSERVED:1,DEPOSIT_FINALIZED:2,BURN_READY:2,
  BURN_BROADCAST:3,BURN_FINALIZED:4,ATTESTED:5,CLAIMED:5,MINTED:6,COMPLETED:7};
const titles = ['Waiting for deposit','Confirming deposit','Burning Native KPEPE','Confirming Native burn','Verifying burn','Minting Solana KPEPE','Final checks','Transfer completed'];
export function forwardProgress(operation) {
  const op = typeof operation === 'string' ? {state:operation} : operation ?? {};
  const position = positions[op.state] ?? 0, details = {};
  if(op.depositConfirmations !== undefined) details[1] = Math.min(op.depositConfirmations,12) + ' / 12';
  if(op.burnConfirmations !== undefined && op.burnConfirmations !== null) details[3] = Math.min(op.burnConfirmations,12) + ' / 12';
  return {title: op.exception ? 'Transfer needs review' : titles[position], steps:FORWARD_STEPS.map((label,index)=>({label,
    detail:details[index] ?? (index < position ? 'Verified' : index === position ? 'In progress' : 'Pending'),
    state:index < position ? 'complete' : index === position ? 'current' : 'pending'}))};
}
