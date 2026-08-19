import { describe, expect, it } from 'vitest'
import { sqlGuardError, sqlPredicateGuardError } from './sql-guard.js'

describe('sqlGuardError', () => {
  it('allows a plain SELECT', () => {
    expect(sqlGuardError('SELECT Faultid FROM Faults')).toBeNull()
  })

  it('rejects non-SELECT statements', () => {
    expect(sqlGuardError('UPDATE Faults SET Status = 9')).toBe('Only SELECT queries are allowed.')
  })

  it('rejects multiple statements', () => {
    expect(sqlGuardError('SELECT 1; SELECT 2')).toBe('Multiple statements are not allowed.')
  })

  it('rejects embedded DML/DDL keywords', () => {
    expect(sqlGuardError('SELECT 1 FROM Faults WHERE 1=1; DROP TABLE Faults')).toBe(
      'Multiple statements are not allowed.',
    )
    expect(sqlGuardError('SELECT * FROM (DELETE FROM Faults) x')).toBe(
      'Only SELECT queries are allowed. DML/DDL statements are blocked.',
    )
  })
})

describe('sqlPredicateGuardError', () => {
  it('accepts a plain predicate', () => {
    expect(sqlPredicateGuardError("Dinvno = 'PC-0042'")).toBe(null)
  })

  it('rejects semicolons and DML', () => {
    expect(sqlPredicateGuardError('1=1; DROP TABLE Faults')).toBeTruthy()
    expect(sqlPredicateGuardError('1=1 UNION SELECT 1 INSERT INTO x')).toBeTruthy()
  })
})
