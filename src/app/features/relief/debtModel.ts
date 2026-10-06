// What the screens that a ride debt blocks say about it, and whether they offer to pay it. Pure: the debt and the cash are passed in.
// The debt is what is STILL owed (state.travel.rideDebt falls with every repayment), never the fare of the ride.
const money = (value: number): string => `₦${Math.round(value).toLocaleString('en-NG')}`

export interface DebtLine {
  /** The whole sentence: nothing here is cut short. */
  text: string
  /** Cash covers the whole debt: the button pays it. Otherwise the button opens "What you can do now". */
  canPay: boolean
  button: string
}
/** Null when nothing is owed, so every place that shows it disappears with the debt. */
export function debtLine(debt: number, cash: number): DebtLine | null {
  if (!(debt > 0)) return null
  if (cash >= debt) return { text: `You owe ${money(debt)} for your ride home. Pay it and the trip, or the home, is open to you.`, canPay: true, button: `Pay ${money(debt)} now` }
  return { text: `You still owe ${money(debt)} for your ride home and have ${money(cash)}. Half of each earning repays it.`, canPay: false, button: 'What you can do now' }
}
