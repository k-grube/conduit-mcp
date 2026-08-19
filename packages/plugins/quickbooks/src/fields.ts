// field allowlists for QBO list tools. detail/get tools return raw QBO objects
// (with a deep-link url added) so they're not filtered here.

export function pickFields<T extends Record<string, unknown>>(obj: T, fields: readonly string[]): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const key of fields) {
    if (key in obj) {
      result[key] = obj[key]
    }
  }
  return result as Partial<T>
}

export const QBO_CUSTOMER_LIST_FIELDS = ['id', 'displayName', 'companyName', 'balance', 'active', 'url'] as const

export const QBO_INVOICE_LIST_FIELDS = [
  'id',
  'docNumber',
  'customerRef',
  'txnDate',
  'dueDate',
  'totalAmt',
  'balance',
  'status',
  'url',
] as const

export const QBO_PAYMENT_LIST_FIELDS = [
  'id',
  'customerRef',
  'txnDate',
  'totalAmt',
  'unappliedAmt',
  'paymentMethodRef',
  'url',
] as const

export const QBO_ACCOUNT_LIST_FIELDS = [
  'id',
  'name',
  'fullyQualifiedName',
  'accountType',
  'accountSubType',
  'classification',
  'currentBalance',
  'active',
  'parentRef',
  'url',
] as const

export const QBO_TRANSACTION_LIST_FIELDS = [
  'date',
  'type',
  'entityType',
  'txnId',
  'docNum',
  'name',
  'nameId',
  'account',
  'accountId',
  'splitAccount',
  'amount',
  'balance',
] as const

export const QBO_RECURRING_LIST_FIELDS = [
  'id',
  'name',
  'type',
  'scheduleType',
  'intervalType',
  'numInterval',
  'startDate',
  'nextDate',
  'customerRef',
  'vendorRef',
  'totalAmt',
  'active',
] as const
