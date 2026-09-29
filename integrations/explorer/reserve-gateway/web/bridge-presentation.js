// Presentation only. Progress follows independently verified journal state.
// Nothing here decides admission, amounts or funding; the Bridge does.
export const FORWARD_STEPS = Object.freeze(['Deposit','Confirmed','Burn','Burn Finality','Attested','Minted','Completed']);
const positions = {DEPOSIT_ADDRESS_ISSUED:0,DEPOSIT_OBSERVED:1,DEPOSIT_FINALIZED:2,BURN_READY:2,
  BURN_BROADCAST:3,BURN_FINALIZED:4,ATTESTED:5,CLAIMED:5,MINTED:6,COMPLETED:7};
const titles = ['Waiting for deposit','Confirming deposit','Burning Native KPEPE','Confirming Native burn','Verifying burn','Minting Solana KPEPE','Final checks','Transfer completed'];
export const BUSY_MESSAGE = 'Another bridge transfer is currently being processed. Please wait until the Bridge becomes available.';
const pending = () => FORWARD_STEPS.map(label => ({label, detail:'Pending', state:'pending'}));

// Exact decimal display of an atomic amount: thousands separators, no rounding,
// no trailing zeros. 100000000000 -> "1,000".
export function formatAmount(value, decimals = 8) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/u.test(value) || ![8, 9].includes(decimals)) throw new Error('AMOUNT');
  const n = BigInt(value), scale = 10n ** BigInt(decimals);
  const whole = (n / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ','), fraction = (n % scale).toString().padStart(decimals, '0').replace(/0+$/u, '');
  return fraction ? whole + '.' + fraction : whole;
}

// What the public status means for someone about to start a transfer.
// canStart is a display decision only: the Bridge itself admits or refuses.
export function bridgeAvailability(status) {
  if (!status) return {key:'UNAVAILABLE', tone:'bad', pill:'Unavailable', title:'Bridge status unavailable', canStart:false,
    message:'Verified Bridge status is unavailable. Do not send funds. Keep any existing operation ID.'};
  if (status.state === 'ACTIVE' && status.executionSlot === 'AVAILABLE') return {key:'AVAILABLE', tone:'ok', pill:'Available', title:'Bridge available', canStart:true,
    message:'Connect your Solana wallet, request your deposit address, then send Native KPEPE once to that address.'};
  if (status.executionSlot === 'BRIDGE_BUSY' && (status.state === 'ACTIVE' || status.accountingRefreshState === 'VERIFYING'))
    return {key:'BUSY', tone:'warn', pill:'Busy', title:'Bridge busy', canStart:false, message:BUSY_MESSAGE};
  if (status.state === 'ACTIVE') return {key:'CHECKING', tone:'muted', pill:'Checking', title:'Checking availability', canStart:false,
    message:'Bridge availability is being verified. Do not send funds yet.'};
  if (status.accountingRefreshState === 'VERIFYING') return {key:'VERIFYING', tone:'warn', pill:'Verifying', title:'Bridge verifying', canStart:false,
    message:'The Bridge is verifying its accounting. New transfers are temporarily unavailable. Existing transfers continue automatically.'};
  return {key:'PAUSED', tone:'warn', pill:'Paused', title:'Bridge paused', canStart:false,
    message:'New transfers are paused. Do not send another deposit. Existing transfers remain bound to their original wallet.'};
}

export function forwardProgress(operation) {
  const op = typeof operation === 'string' ? {state:operation} : operation ?? {};
  if (!op.state) return {title:'Not started', tone:'muted', steps:pending()};
  const position = positions[op.state] ?? 0, details = {};
  if (op.state === 'DEPOSIT_ADDRESS_ISSUED') details[0] = 'Waiting for deposit';
  if (op.depositConfirmations !== undefined) details[1] = Math.min(op.depositConfirmations, 12) + ' / 12';
  if (op.burnConfirmations !== undefined && op.burnConfirmations !== null) details[3] = Math.min(op.burnConfirmations, 12) + ' / 12';
  // A deposit below the minimum, or one waiting for the transfer ahead of it,
  // has not been burned: nothing after the deposit is shown as under way.
  const held = op.depositBelowMinimum === true ? 'Below minimum' : op.executionSlot === 'WAITING_FOR_EXECUTION_SLOT' ? 'Waiting' : null;
  if (held && !op.exception) return {title:op.depositBelowMinimum === true ? 'Deposit below minimum' : 'Waiting for the Bridge', tone:'warn',
    steps:FORWARD_STEPS.map((label, index) => ({label,
      detail:index === 0 ? 'Received' : index === 1 ? details[1] ?? 'Pending' : index === 2 ? held : 'Pending',
      state:index === 0 || index === 1 && op.depositConfirmations >= 12 ? 'complete' : index === 2 ? 'held' : 'pending'}))};
  return {title:op.exception ? 'Transfer needs review' : titles[position], tone:op.exception ? 'warn' : op.state === 'COMPLETED' ? 'ok' : 'info',
    steps:FORWARD_STEPS.map((label, index) => ({label,
      detail:details[index] ?? (index < position ? 'Verified' : index === position ? 'In progress' : 'Pending'),
      state:index < position ? 'complete' : index === position ? 'current' : 'pending'}))};
}

// The sentence under the progress list. Never names an amount still to send,
// and never promises a refund: neither exists.
export function operationHelp(op, minimumText) {
  if (!op) return 'Connect your wallet and request a deposit address to start.';
  if (op.exception) return 'This deposit needs review by the KingPepe Team. Do not send again. The destination of this transfer remains fixed.';
  if (op.depositBelowMinimum === true) return 'The deposit received is below the minimum of ' + minimumText + ' KPEPE, so it has not been burned or bridged. ' +
    'Do not send another deposit to this address: separate deposits are not combined. Keep your operation ID and contact the KingPepe Team.';
  if (op.executionSlot === 'WAITING_FOR_EXECUTION_SLOT') return 'Your deposit is confirmed and is waiting for another transfer to finish. It will continue automatically. Do not send again.';
  if (op.state === 'COMPLETED') return 'Your exact KPEPE amount has arrived on Solana.';
  if (op.state === 'DEPOSIT_ADDRESS_ISSUED') return 'Send Native KPEPE once to your deposit address. You can close this page and return with your operation ID.';
  return 'Processing is automatic. You can close this page and return with your operation ID.';
}
