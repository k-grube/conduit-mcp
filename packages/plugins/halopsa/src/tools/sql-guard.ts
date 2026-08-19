// same rules halopsa_query enforces; reports additionally persist the sql for later re-execution
const DML_KEYWORDS = [
  'INSERT ',
  'UPDATE ',
  'DELETE ',
  'DROP ',
  'ALTER ',
  'CREATE ',
  'TRUNCATE ',
  'EXEC ',
  'EXECUTE ',
  'GRANT ',
  'REVOKE ',
]

// returns an error string or null when the sql is acceptable
export function sqlGuardError(sql: string): string | null {
  const normalized = sql.trim().toUpperCase()
  if (!normalized.startsWith('SELECT')) {
    return 'Only SELECT queries are allowed.'
  }
  if (normalized.includes(';')) {
    return 'Multiple statements are not allowed.'
  }
  if (DML_KEYWORDS.some((kw) => normalized.includes(kw))) {
    return 'Only SELECT queries are allowed. DML/DDL statements are blocked.'
  }
  return null
}

// guards a bare WHERE predicate interpolated into discovery sql; not a full statement,
// so no SELECT-prefix requirement, but the same no-multistatement/no-DML rules apply
export function sqlPredicateGuardError(where: string): string | null {
  const normalized = where.trim().toUpperCase()
  if (normalized.includes(';')) {
    return 'Multiple statements are not allowed.'
  }
  if (DML_KEYWORDS.some((kw) => normalized.includes(kw))) {
    return 'Only SELECT predicates are allowed. DML/DDL statements are blocked.'
  }
  return null
}
