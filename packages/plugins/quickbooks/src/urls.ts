import type { QboEnvironment } from './secret-names.js'

// sandbox apps live on sandbox.qbo.intuit.com regardless of realm
function appBase(env: QboEnvironment): string {
  return env === 'sandbox' ? 'https://sandbox.qbo.intuit.com' : 'https://app.qbo.intuit.com'
}

export function qboCustomerUrl(customer: Record<string, unknown>, env: QboEnvironment): Record<string, unknown> {
  const id = customer.id ?? customer.Id
  if (typeof id === 'string' || typeof id === 'number') {
    return { ...customer, url: `${appBase(env)}/app/customerdetail?nameId=${id}` }
  }
  return customer
}

export function qboInvoiceUrl(invoice: Record<string, unknown>, env: QboEnvironment): Record<string, unknown> {
  const id = invoice.id ?? invoice.Id
  if (typeof id === 'string' || typeof id === 'number') {
    return { ...invoice, url: `${appBase(env)}/app/invoice?txnId=${id}` }
  }
  return invoice
}

export function qboPaymentUrl(payment: Record<string, unknown>, env: QboEnvironment): Record<string, unknown> {
  const id = payment.id ?? payment.Id
  if (typeof id === 'string' || typeof id === 'number') {
    return { ...payment, url: `${appBase(env)}/app/recvpayment?txnId=${id}` }
  }
  return payment
}

export function qboAccountUrl(account: Record<string, unknown>, env: QboEnvironment): Record<string, unknown> {
  const id = account.id ?? account.Id
  if (typeof id === 'string' || typeof id === 'number') {
    return { ...account, url: `${appBase(env)}/app/register?accountId=${id}` }
  }
  return account
}

const TXN_URL_PATH: Record<string, string> = {
  Invoice: 'invoice',
  Payment: 'recvpayment',
  Bill: 'bill',
  JournalEntry: 'journal',
  Deposit: 'deposit',
  Purchase: 'expense',
  Transfer: 'transfer',
  CreditMemo: 'creditmemo',
  VendorCredit: 'vendorcredit',
  SalesReceipt: 'salesreceipt',
  RefundReceipt: 'refund',
  BillPayment: 'billpayment',
}

export function qboTransactionUrl(
  entityType: string,
  txn: Record<string, unknown>,
  env: QboEnvironment,
): Record<string, unknown> {
  const id = txn.Id ?? txn.id
  const path = TXN_URL_PATH[entityType]
  if (path && (typeof id === 'string' || typeof id === 'number')) {
    return { ...txn, url: `${appBase(env)}/app/${path}?txnId=${id}` }
  }
  return txn
}
