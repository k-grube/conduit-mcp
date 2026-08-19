import { defineTool, z, trimResponse, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { activityGuidance } from '../activity.js'
import { trimReportEnvelope } from '../fields.js'
import { sqlGuardError, sqlPredicateGuardError } from './sql-guard.js'

const SCHEMA_RULES = `## Critical Rules
- NEVER guess table names, column names, or JOIN relationships - always use halopsa_get_schema (with section='relationships') to look them up first. HaloPSA uses non-obvious naming conventions that cannot be inferred.
- All datetimes are stored in UTC
- Fdeleted = 0 for active records (integer)
- Users.uinactive = 0 AND Users.uisserviceaccount = 0 for active end users (service accounts inflate counts ~40%), Uname.Inactive = 0 for active agents; always filter by default unless asked
- Never use Fclosed column - use Status=9 for closed tickets
- Close date is 'Datecleared', not 'Closeddate'
- Occurrence date is 'Dateoccured' (note: no 'r' - HaloPSA typo)
- Ticket summary is in 'Symptom' field
- Ticket type: use Requesttypenew -> Requesttype.Rtid
- Feedback ratings: 1=best, 5=worst
- Only SELECT queries are allowed
- Use GETDATE() for current time`

const SCHEMA_TABLES = `## Core Tables

### Faults (Tickets)
Faultid, Symptom (summary), Status, Dateoccured, Datecleared, Areaint (client FK), Assignedtoint (agent FK), Username, Userid (user FK), Fdeleted (0=active, 1=deleted), Requesttype, Requesttypenew, Sectio_ (team), Phonenumber, Fresponsetime, Elapsedhrs, Cleartime, Ffirsttimefix, Foppvalue, Foppconversionprobability, Fopptargetdate, Cfexpectedclose, Fflowid, Fflowstep, Fmergedintofaultid (0=not merged, >0=merged into that ticket), fxrefto (NULL or 0 = no parent, >0 = parent ticket ID; NULL on nearly all normal tickets, so NEVER test \`fxrefto = 0\` - it matches almost nothing), fChildCount (number of child tickets), Fexcludefromsla, Datefullyclosed

**Standard exclusion filters:** Most ticket queries should include: \`Fdeleted = 0 AND Fmergedintofaultid = 0\`. Add \`ISNULL(fxrefto, 0) = 0\` to also exclude child tickets (sales-order/project subtasks).

**Custom-field columns (Cf*):** tenant-created, absent on stock instances. Probe before relying on one; 'Invalid pseudocolumn'/'Invalid column name' means the field is not defined on this instance.

### Actions (Ticket Notes/Time Entries)
Faultid (FK), Who (name), Whoagentid (agent FK), Actoutcome, Note, Timetaken (hours decimal), Whe_ (datetime), Actionnumber, Category2, Mileage, Actisbillable, Nonbilltime, Timetakenadjusted, Actionhide

### Area (Clients/Companies)
Aarea (PK), Aareadesc (name), Apritech (primary tech FK), Aaccountmanagertech (acct mgr FK), Aaccountsemailaddress, Aaccountsccemailaddress, Aaccountsfirstname, Aaccountslastname, Cfprimarycontact, Cftype, Aisinactive, Aninjarmmid, Adatecreated, Acustomertype

### Site (Sites/Locations)
Ssitenum (PK), Sdesc (name), Sarea (client FK), Sphonenumber

### Users (End Users/Contacts)
Uid (PK), Uusername, Uemail, Uemail2, Usite (site FK), Uarea (client FK), Uinactive, Uisserviceaccount, Userviceaccountoverridden, Uignoreautomatedbilling, Cfuserbillingtype, Uextn (phone), Umobile, Umobile2, Utelhome, Uother1 (department), Utitle, Uazureoid, Uazurelastlogindate, Uispoapprover

### Uname (Agents/Technicians)
Unum (PK), Uname (display name), Udesc, Uemail, Usection (team), Ucostprice (hourly cost), Utechstatus, Uactived, Inactive

### Tstatus (Status Definitions)
Tstatus (PK), Tstatusdesc (name)

### Requesttype (Ticket Types)
Rtid (PK), Rtdesc (name), Rtisopportunity (bool), Rtisproject (bool)

## Financial Tables

### Invoiceheader
Ihid (PK, positive=invoice, negative=recurring), Ihname, Ihaarea (client FK), Ihinvoice_Date, Ihdue_Date, Ihamountpaid, Ihamountdue, Ihrecurringinvoiceid, Ihohid (order FK, -2=ad-hoc), Ihtype, Ihchid (contract FK), Ihdatepaid, Ihdatecreated, Ihlast_Modified, Ihreference, Ihposted, Ihvoided, Ihnotes_1, Ih3rdpartyinvoicenumber, Ihoriginalclientid, Ihsitenumber, Ihperiodstartdate, Ihperiodenddate

### Invoicedetail (Line Items)
Idid (PK), Idihid (invoice FK), Iditem_Shortdescription, Idunit_Price, Idunit_Cost, Idqty_Order, Idnet_Amount, Idisgroupdesc ('false' for real lines), Idfaultid (ticket FK), Id_Itemid (item FK), Idisbundledline, Idquantitycustom

### Orderhead (Sales Orders)
Ohid (PK), Ohfaultid (ticket FK), Ohinvoicenumber (invoice FK), Ohorderdate, Ohstatus, Ohsitenum (site FK), Ohtitle, Ohsummary, Ohuserstatus (Lookup FK, Fid=34)

### Orderline (Sales Order Lines)
Olid (order FK - same ID as Orderhead.Ohid), Olitem (item FK), Olsellingprice, Olcostprice, Olorderqty, Oldesc, Oldiscount, Oltax, Olisgroupdesc ('false' for real lines), Olbillingperiod, Olsupplierpo (PO number)

### Licence (Subscriptions)
Lid (PK), Ldesc, Lcount (qty), Lprice (sell), Lpurchaseprice (cost), Larea (client FK), Ldistributor, Ltermduration, Lbillingcycle, Lisactive, Ltype (1=subscription), Lstatus, Lpurchasedate

### Contractheader (Contracts)
Chid (PK), Charea (client FK), Chcontractref, Chstartdate, Chenddate, Chbillingdescription, Chbillingperiod

### Contractuser (Contract-User Links)
Cuchid (contract FK), Cuuid (user FK), Cucovered

## Asset Tables

### Device (Assets/Devices)
Did (PK), Dinvno (asset tag/hostname), Dtype (type FK), Dsite (site FK), Ddevnum, Dninjarmmid, Dwarrantyenddate, Dinactive, Dslaid, Ditglueid

### Xtype (Asset Types)
Ttypenum (PK), Tdesc (name), Tlabelseqnos

### Deviceapplications (Software/Licenses on Users)
Dauserid (user FK), Dadesc (application name)

### Item (Products/Catalog)
Iid (PK), Idesc, Igeneric (group FK), Iisrecurringitem

### Generic (Item Groups)
Ggeneric (PK), Gdesc (name)

## Reference Tables

### Lookup (Dynamic Lookups)
Fid (lookup type), Fcode (value code), Fvalue (display value)
Common Fid: 28=billing desc, 33=customer type, 34=order status, 35=expense type, 49=tech status, 136=user billing type

### Audit (Change History)
Atablename, Afaultid, Apkid1, Apkid2, Avalue (field), Afrom, Ato, Adate, Aunum (agent FK)

### Expense
Exid, Exunum (agent FK), Exfaultid (ticket FK), Exdescription, Examount, Extypelookup, Exdateadded, Exdatereimbursed, Exreviewed

### Flowheader/Flowdetail/Flowstages (Workflow/Pipeline)
Flowheader: Fhid (PK). Flowdetail: Fdfhid, Fdseq, Fdstagenumber. Flowstages: Fsfhid, Fsseq, Fsdesc (stage name)

### Quotationheader/Quotationdetail (Quotes)
Quotationheader: Qhid (PK), Qhfaultid (ticket FK), Qhdate, Qhtitle, Qhcurrency
Quotationdetail: Qdqhid (quote FK), Qditemid (item FK), Qdprice, Qdcostprice, Qdquantity, Qdtax, Qdbillingperiod

### Areaazuretenant (Azure Tenant Mappings)
Aatareaid (client FK), Aatazuretenantid, Aatazuretenantname, Aatazuretenantdomain

### Organisation (Org Settings)
Orid, Cfexpensemileagereimbursementrate`

const SCHEMA_RELATIONSHIPS = `## Key JOIN Relationships

### Tickets
Faults.Areaint -> Area.Aarea (client)
Faults.Assignedtoint -> Uname.Unum (agent)
Faults.Status -> Tstatus.Tstatus (status)
Faults.Requesttypenew -> Requesttype.Rtid (type)
Faults.Userid -> Users.Uid (requester)
Faults.Fflowid -> Flowheader.Fhid (workflow)

### Actions
Actions.Faultid -> Faults.Faultid
Actions.Whoagentid -> Uname.Unum

### Sites & Users
Users.Usite -> Site.Ssitenum
Users.Uarea -> Area.Aarea
Site.Sarea -> Area.Aarea
Deviceapplications.Dauserid -> Users.Uid

### Devices
Device.Dsite -> Site.Ssitenum
Device.Dtype -> Xtype.Ttypenum

### Financial
Invoiceheader.Ihaarea -> Area.Aarea
Invoicedetail.Idihid -> Invoiceheader.Ihid
Invoicedetail.Id_Itemid -> Item.Iid
Orderline.Olid -> Orderhead.Ohid
Orderhead.Ohfaultid -> Faults.Faultid
Orderhead.Ohinvoicenumber -> Invoiceheader.Ihid
Licence.Larea -> Area.Aarea
Item.Igeneric -> Generic.Ggeneric
Quotationheader.Qhfaultid -> Faults.Faultid

### Workflow/Pipeline (for Opportunities)
Faults.Fflowid -> Flowheader.Fhid
Flowdetail: Fdfhid = Flowheader.Fhid AND Faults.Fflowstep = Flowdetail.Fdseq
Flowstages: Fsfhid = Flowdetail.Fdfhid AND Fdstagenumber = Flowstages.Fsseq

## Billing Period Codes
0=One-time/NRR, 1=Weekly, 2=Monthly, 3=Yearly, 4=Quarterly, 5=6-Monthly, 6=5-Yearly, 7=3-Yearly, 8=2-Yearly, 9=4-Yearly`

const SCHEMA_EXAMPLES = `## Example Queries (Advanced Analytics Only)
For listing tickets, clients, assets, quotes, contracts, invoices, or subscriptions - ALWAYS use the dedicated halopsa_list_* tools instead. These examples show aggregations and joins that dedicated tools cannot do.

### Time logged by agent (last 30 days)
SELECT Uname.Uname AS Agent, ROUND(SUM(ISNULL(Actions.Timetaken, 0)), 2) AS HoursLogged
FROM Actions
JOIN Faults ON Actions.Faultid = Faults.Faultid
JOIN Uname ON Actions.Whoagentid = Uname.Unum
WHERE Actions.Timetaken > 0 AND Actions.Whoagentid > 0 AND Actions.Whe_ >= DATEADD(DAY, -30, GETDATE())
GROUP BY Uname.Uname ORDER BY HoursLogged DESC

### Client revenue (last 3 months)
SELECT Area.Aareadesc AS Client, ROUND(SUM(Ihamountpaid + Ihamountdue), 2) AS Revenue
FROM Invoiceheader JOIN Area ON Invoiceheader.Ihaarea = Area.Aarea
WHERE Ihid > 0 AND Ihinvoice_Date >= DATEADD(MONTH, -3, GETDATE())
GROUP BY Area.Aareadesc ORDER BY Revenue DESC

### Users with licenses for a client
SELECT Uusername, Uemail, Area.Aareadesc AS Customer,
  STUFF((SELECT ' | ' + CAST(Dadesc AS VARCHAR(1000)) FROM Deviceapplications WHERE Dauserid = Da.Dauserid
    FOR XML PATH(''), TYPE).Value('.', 'NVARCHAR(MAX)'), 1, 2, ' ') AS Licenses
FROM Deviceapplications Da
LEFT JOIN Users ON Uid = Dauserid LEFT JOIN Site ON Ssitenum = Usite LEFT JOIN Area ON Aarea = Sarea
WHERE Dauserid > 0 GROUP BY Aareadesc, Uusername, Uemail, Dauserid

### Sales orders with profit
SELECT Ohid AS SalesOrder, Area.Aareadesc AS Customer, Oldesc AS Item,
  Lookup.Fvalue AS Status, Olorderqty AS Qty,
  ROUND(Olsellingprice * Olorderqty, 2) AS SalesPrice, ROUND(Olcostprice * Olorderqty, 2) AS CostPrice,
  ROUND((Olsellingprice - Olcostprice) * Olorderqty, 2) AS Profit
FROM Orderhead JOIN Orderline ON Olid = Ohid
LEFT JOIN Site ON Ohsitenum = Ssitenum LEFT JOIN Area ON Aarea = Sarea
LEFT JOIN Lookup ON Ohuserstatus = Lookup.Fcode AND Lookup.Fid = 34 -- system lookup: order statuses
WHERE Olisgroupdesc = 'false'

### Open opportunities with pipeline stage
SELECT Faults.Faultid, ROUND(Foppvalue, 2) AS Value, Faults.Symptom AS Summary,
  Uname.Udesc AS AssignedTo, Tstatus.Tstatusdesc AS Status, Flowstages.Fsdesc AS SalesStage
FROM Faults
LEFT JOIN Requesttype ON Faults.Requesttypenew = Requesttype.Rtid
LEFT JOIN Uname ON Faults.Assignedtoint = Uname.Unum
LEFT JOIN Tstatus ON Faults.Status = Tstatus.Tstatus
LEFT JOIN Flowheader ON Faults.Fflowid = Flowheader.Fhid
LEFT JOIN Flowdetail ON Flowheader.Fhid = Flowdetail.Fdfhid AND Faults.Fflowstep = Flowdetail.Fdseq
LEFT JOIN Flowstages ON Flowdetail.Fdfhid = Flowstages.Fsfhid AND Flowdetail.Fdstagenumber = Flowstages.Fsseq
WHERE Faults.Fdeleted = 0 AND Requesttype.Rtisopportunity = 1 AND Tstatus.Tstatusdesc NOT IN ('Closed')

### Avg response & resolution time by month
SELECT CONVERT(nvarchar(7), Dateoccured, 126) AS Month,
  ROUND(AVG(Fresponsetime), 2) AS AvgResponseTime, ROUND(AVG(Elapsedhrs), 2) AS AvgResolutionTime
FROM Faults WHERE Status IN (8, 9) AND Dateoccured > DATEADD(MONTH, -12, GETDATE())
GROUP BY CONVERT(nvarchar(7), Dateoccured, 126)

### Commission report (invoices with profit)
SELECT Area.Aareadesc AS Client, Ih3rdpartyinvoicenumber AS InvNum, Ihinvoice_Date AS InvDate,
  Iditem_Shortdescription AS Item, Idqty_Order AS Qty, Idunit_Price AS Sell, Idunit_Cost AS Cost,
  ROUND(Idunit_Price - Idunit_Cost, 2) AS Margin
FROM Invoiceheader JOIN Invoicedetail ON Idihid = Ihid AND Idisgroupdesc = 'false'
JOIN Area ON Aarea = Ihaarea WHERE Ihid > 0

### Audit trail for ticket changes
SELECT Afaultid AS Ticket, Avalue AS Field, Afrom AS [From], Ato AS [To], Adate AS Date,
  (SELECT Uname FROM Uname WHERE Aunum = Unum) AS Agent
FROM Audit WHERE Atablename = 'faults' AND Avalue NOT LIKE 'Ticket ID%' ORDER BY Adate DESC

### Client overview with open ticket counts and assigned agents
SELECT Area.Aareadesc AS Client,
  (SELECT Uname FROM Uname WHERE Unum = Area.Apritech) AS PrimaryAgent,
  (SELECT Uname FROM Uname WHERE Unum = Area.Aaccountmanagertech) AS AccountManager,
  (SELECT COUNT(*) FROM Faults WHERE Areaint = Area.Aarea AND Fdeleted = 0
    AND Status NOT IN (SELECT Tstatus FROM Tstatus WHERE Tstatusdesc = 'Closed')) AS OpenTickets
FROM Area WHERE Aisinactive = 0`

const SCHEMA_VARIABLES = `## Report SQL Context Variables (viewer auto-filtering)

Halo string-substitutes these into report SQL per viewer before execution, so one report self-scopes to whoever views it (all verified live):
- $agentid - the agent viewing the report in the agent app ("my tickets" boards: WHERE Assignedtoint = $agentid)
- $clientid, $siteid, $userid - the logged-in portal user's client/site/user id (portal-embedded reports)
- $invoiceid - invoice context (invoice-attached reports)
Case-insensitive ($CLIENTID = $clientid = $ClientId).

Via the API (halopsa_query, halopsa_run_report, report create/update preview validation) they still substitute, but with API context: $agentid -> the API app's agent id, $clientid/$siteid/$userid -> 0. A viewer-filtered report therefore legitimately returns 0 rows through the API - verify those reports in the portal/agent app, not here.

Halo's own variable list is hard-coded in its web UI bundle (no API serves it) and incomplete - undocumented variables exist. To test a candidate: SELECT $candidate AS x via halopsa_query. Real variable -> substituted value; not a variable -> load_error 'Invalid pseudocolumn "$candidate"'.

Other $-variable families are NOT usable in SQL: $REPORTDATA/$REPORTTITLE/$OR*/$ACCOUNTMANAGER* etc. work only in Halo PDF/email templates; $REPORTROWS/$ColumnAlias only in report HTML table templates (report_table_html/report_table_row_html).`

const SCHEMA_CANON = `## Canonical Definitions
Use these exact rules so numbers match across sessions.

### Ticket dates and exclusions
- Opened = Dateoccured, closed = Datecleared. Never Datecreated (corrupt row-stamp) or Fclosed.
- Standard exclusions: Fdeleted = 0 AND Fmergedintofaultid = 0; add ISNULL(fxrefto, 0) = 0 to drop child tickets.
- Exclude closed-on-creation stubs (Datecleared <= Dateoccured, e.g. quick-time entries) from service metrics.
- Action work date = COALESCE(Whe_, ActionArrivalDate, ActionDateCreated) (ActionDateCreated can be backdated).

### Time and billability
- Timetaken = raw logged hours; Timetakenadjusted = rounded per the rate's rounding rule.
- Actioncode is the charge-RATE id: Actioncode + 1 > 0 means billable (0/-1 = no charge).
- Billable hours = Actionchargehours (invoiceable T&M) + Actionnonchargehours (covered by an agreement, still billable) + Actionprepayhours (drawn from prepay). All three are billable, just to different buckets. Do NOT treat Actionnonchargehours as non-billable and do NOT use Actisbillable (over-counts).

### MRR / recurring revenue
- Classify recurring at the LINE level: Invoicedetail.Idrecurringinvoiceid < -1 (-1 is the not-recurring sentinel). Do NOT filter on the Invoiceheader recurring bit (reads false on generated children).
- On generated non-void invoices: Ihid > 0 AND ISNULL(Ihvoided, 0) = 0, active lines ISNULL(idisInactive, 0) = 0.
- MRR = recurring invoiced in the latest COMPLETE calendar month; never TTM/12 (under-reports short billing history). Always pull current + trailing two months side by side, recurring billing is lumpy (quarterly/annual land in one month).
- Contract is on the line: Invoicedetail.Idchid -> Contractheader.Chid.

### Revenue recognition
- Recognised revenue for an action = Invoicedetail.Idnet_Amount of the line linked via Actions.Actioninvoicelineid; SUM over DISTINCT line ids (many actions fan out to one line, per-action sum multiplies).
- Prepay-recognised amount = Actions.Adefprepayamount.

### Prepay accounts
- Contract grain. Prepayhistory rows split by SIGN: positive = refills (cash collected), negative = manual deductions / expirations (classify via ppDesc).
- Consumed hours = Actions.Actionprepayhours. Remaining = refills - consumed - manual - expired.

### Agent cost
- Uname.ucostPrice (hourly), or UnameCostTracking (uctCost, date-ranged uctStartDate/uctEndDate) when cost history is enabled. Both hourly; a tenant may store annual salaries there, sanity-check magnitude. Avoid CF* custom-field columns.
- Exclude bot/API agents (ISNULL(uisapiagent, 0) = 0) and the Unassigned pseudo-agent (Unum <> 1).

### MTTR / working hours
- Wall-clock DATEDIFF(minute, Dateoccured, Datecleared) includes customer-wait/hold time.
- Working-hours version: dbo.Fn_GetWorkingHours_datetimes(@start, @end, @slaid, @faultid, @timezone). @timezone MUST be a Windows tz name ('Pacific Standard Time'); NULL or the IANA value Halo stores throws an AT TIME ZONE error. Clamp negative results to 0.

### Reactive vs project work
- Faults.Requesttype carries the ITIL class code directly (equals Requesttype.Rtrequesttype via Requesttypenew -> Rtid).
- Reactive support = Requesttype IN (1, 3) (Incident + Service Request). Stock class codes: 1 = Incident (also alerts/scheduled tasks/quick time), 2 = Change, 3 = Service Request, 4 = Problem, 21 = sales (opportunity/lead/quote), 22 = Project. Tenants can remap or add classes: verify with SELECT Rtid, Rtdesc, Rtrequesttype FROM Requesttype before trusting totals.
- Do NOT use Rtisproject/Rtisopportunity flags for reactive (tenant-defined classes can carry neither flag and leak into reactive counts); filter on class codes.

### Money and naming
- Home currency = the Currency row with Crate = 1.0. Don't assume a symbol.
- Halo's stored system values use British spellings (licence, colour, organisation); check both spellings when matching strings.

### Report Center SQL constraints
- No '--' line comments (use /* block comments */), no trailing semicolon, no DECLARE/@vars/#temp tables.
- ORDER BY is invalid without TOP, OFFSET, or FOR XML. Never combine TOP with OFFSET; to cap an ordered set use OFFSET 0 ROWS FETCH NEXT n ROWS ONLY.`

const SCHEMA_SECTIONS: Record<string, string> = {
  rules: SCHEMA_RULES,
  tables: SCHEMA_TABLES,
  relationships: SCHEMA_RELATIONSHIPS,
  examples: SCHEMA_EXAMPLES,
  variables: SCHEMA_VARIABLES,
  canon: SCHEMA_CANON,
}

// live status/agent enrichment, 5-minute ttl, module-scope so it survives across calls
let liveDataCache: { text: string; expiresAt: number } | undefined

export function resetLiveDataCache(): void {
  liveDataCache = undefined
}

export const queryTools: ToolDef[] = [
  defineTool({
    name: 'halopsa_get_schema',
    description:
      "Get the HaloPSA database schema for writing advanced SQL queries. Only needed when the dedicated halopsa_list_*/halopsa_get_* tools cannot answer the question (e.g. custom aggregations, time-series analytics, multi-table joins). Sections: 'rules' (naming conventions), 'tables' (definitions), 'relationships' (JOINs/FKs), 'canon' (billability/MRR/prepay/MTTR/reactive definitions), 'examples' (example SQL), 'variables' (viewer-context auto-filter vars like $clientid/$agentid + template var families), 'live_data' (status/agent IDs). Default is 'rules,tables,relationships,canon'. Also does live discovery via action='tables'|'columns'|'sample' (see param docs); use it before writing SQL against tables you have not verified.",
    keywords: ['halopsa', 'schema', 'sql', 'database', 'tables', 'query'],
    params: {
      section: z
        .string()
        .optional()
        .default('rules,tables,relationships,canon')
        .describe(
          "Comma-separated sections: 'rules', 'tables', 'relationships', 'canon', 'examples', 'variables', 'live_data', 'all'",
        ),
      action: z
        .enum(['tables', 'columns', 'sample'])
        .optional()
        .describe(
          "Live schema discovery instead of the static sections: 'tables' lists base tables (use filter), 'columns' lists one table's columns (table) or searches column names everywhere (filter), 'sample' returns TOP n real rows from a table (optional where) to pin a known value and reverse-engineer which column holds it",
        ),
      table: z.string().optional().describe("Table name for action='columns' or 'sample'"),
      filter: z.string().optional().describe("Name substring for action='tables' or 'columns'"),
      where: z.string().optional().describe("SQL predicate for action='sample', e.g. \"Dinvno = 'PC-0042'\""),
      top: z
        .number()
        .optional()
        .describe('Row cap: default 200 for tables/columns search (max 500), 5 for sample (max 25)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      if (params.action) {
        const client = await getClient(ctx)
        const esc = (s: string) => s.replace(/'/g, "''")
        const table = params.table?.trim()
        const filter = params.filter?.trim()
        if (table && !/^[A-Za-z0-9_]+$/.test(table)) {
          return { error: `Invalid table name '${table}': letters, digits, and underscore only.` }
        }

        let sql: string
        let cap: number
        if (params.action === 'tables') {
          cap = Math.min(Math.max(Math.floor(params.top ?? 200), 1), 500)
          const like = filter ? ` AND TABLE_NAME LIKE '%${esc(filter)}%'` : ''
          sql = `SELECT TOP ${cap} TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'${like} ORDER BY TABLE_NAME`
        } else if (params.action === 'columns') {
          if (table) {
            cap = 500
            sql = `SELECT TOP 500 COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${esc(table)}' ORDER BY ORDINAL_POSITION`
          } else if (filter) {
            cap = Math.min(Math.max(Math.floor(params.top ?? 200), 1), 500)
            sql = `SELECT TOP ${cap} TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME LIKE '%${esc(filter)}%' ORDER BY TABLE_NAME, COLUMN_NAME`
          } else {
            return { error: "action='columns' needs 'table' (one table's columns) or 'filter' (search column names)." }
          }
        } else {
          if (!table) {
            return { error: "action='sample' needs 'table'." }
          }
          if (params.where) {
            const predicateError = sqlPredicateGuardError(params.where)
            if (predicateError) {
              return { error: predicateError }
            }
          }
          cap = Math.min(Math.max(Math.floor(params.top ?? 5), 1), 25)
          // SELECT * is the point here: discover columns and real values in one look
          sql = `SELECT TOP ${cap} * FROM ${table}${params.where ? ` WHERE ${params.where}` : ''}`
        }

        const result = trimReportEnvelope(await client.executeQuery(sql))
        const envelope = (Array.isArray(result) ? result[0] : result) as {
          report?: { rows?: unknown[]; load_error?: string }
        }
        const rows = envelope?.report?.rows ?? []
        if (envelope?.report?.load_error) {
          return { action: params.action, sql, error: envelope.report.load_error }
        }
        return trimResponse({ action: params.action, sql, row_count: rows.length, truncated: rows.length >= cap, rows })
      }

      const requested =
        params.section === 'all'
          ? ['rules', 'tables', 'relationships', 'canon', 'examples', 'variables', 'live_data']
          : params.section.split(',').map((s) => s.trim().toLowerCase())

      const parts: string[] = ['# HaloPSA Database Schema\n']

      for (const key of requested) {
        if (key === 'live_data') {
          continue
        }
        if (SCHEMA_SECTIONS[key]) {
          parts.push(SCHEMA_SECTIONS[key])
        }
      }

      if (requested.includes('live_data')) {
        if (!liveDataCache || Date.now() > liveDataCache.expiresAt) {
          let enrichment = ''
          try {
            const client = await getClient(ctx)
            const [statuses, agents] = await Promise.all([client.getStatuses(), client.getAgents()])
            const statusList = Array.isArray(statuses)
              ? statuses
              : (statuses as Record<string, unknown>)?.statuses || statuses
            const agentList = Array.isArray(agents) ? agents : (agents as Record<string, unknown>)?.agents || agents
            if (Array.isArray(statusList)) {
              enrichment += '\n## Live Status IDs\n'
              for (const s of statusList.slice(0, 30)) {
                const st = s as Record<string, unknown>
                enrichment += `- ${st.id}: ${st.name}\n`
              }
            }
            if (Array.isArray(agentList)) {
              enrichment += '\n## Live Agent IDs\n'
              for (const a of agentList.slice(0, 30)) {
                const ag = a as Record<string, unknown>
                enrichment += `- ${ag.id}: ${ag.name} (${ag.email || ''})\n`
              }
            }
          } catch {
            enrichment += '\n(Could not fetch live status/agent data)\n'
          }
          liveDataCache = { text: enrichment, expiresAt: Date.now() + 5 * 60 * 1000 }
        }
        parts.push(liveDataCache.text)
      }

      return parts.join('\n\n')
    },
  }),

  defineTool({
    name: 'halopsa_query',
    description:
      "Execute a SQL SELECT query against the HaloPSA reporting database for custom aggregations, multi-table joins, and analytics that dedicated tools cannot handle. Accepts a single SQL string or an array of up to 10 uncorrelated SELECT statements executed in a single call, results in input order. Do NOT use for listing or searching tickets, clients, assets, quotes, contracts, invoices, or subscriptions: use the dedicated halopsa_list_* and halopsa_get_* tools instead. Only SELECT with explicit column names allowed. Always call halopsa_get_schema first. When selecting a saved report's SQL from Report.ANALYZERPROFILE (or similar XML-wrapped columns), strip the outer XML tags (e.g. <sql>...</sql>) before reusing the inner query: the tool itself does not unwrap them." +
      `\n\n${activityGuidance()}`,
    keywords: ['halopsa', 'query', 'sql', 'select', 'report', 'analytics'],
    params: {
      sql: z
        .union([z.string(), z.array(z.string()).min(1)])
        .describe(
          'SQL SELECT query to execute, or an array of up to 10 uncorrelated SELECT statements run in one tool call (results return in input order). Use an array only when a single JOIN cannot express the datasets.',
        ),
      maxRows: z
        .number()
        .optional()
        .default(100)
        .describe('Maximum rows to return (default 100, max 500). Injected as TOP N if query has no TOP/OFFSET.'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const { sql, maxRows } = params
      const statements = Array.isArray(sql) ? sql : [sql]
      if (statements.length > 10) {
        return { error: 'Too many statements: max 10 per call.' }
      }
      const rowLimit = Math.min(Math.max(maxRows ?? 100, 1), 500)

      const statementErrors: Array<{ index: number; error: string }> = []
      const finalStatements = statements.map((stmt, index) => {
        const normalized = stmt.trim().toUpperCase()
        const guardError = sqlGuardError(stmt)
        if (guardError) {
          statementErrors.push({ index, error: guardError })
          return stmt
        }
        if (normalized.includes('SELECT *') || normalized.includes('SELECT TOP 100 PERCENT *')) {
          statementErrors.push({ index, error: 'SELECT * is not allowed. Specify the columns you need.' })
          return stmt
        }
        // inject TOP N if the query has no explicit TOP or OFFSET/FETCH, prevents unbounded results
        if (!normalized.includes(' TOP ') && !normalized.includes('OFFSET') && !normalized.includes('FETCH')) {
          return stmt.replace(/^(\s*SELECT\s+)/i, `$1TOP ${rowLimit} `)
        }
        return stmt
      })
      if (statementErrors.length > 0) {
        // single-string input keeps the bare error shape callers already depend on
        if (!Array.isArray(sql)) {
          return { error: statementErrors[0].error }
        }
        return {
          error: 'One or more statements were rejected; nothing was executed.',
          statement_errors: statementErrors,
        }
      }

      const client = await getClient(ctx)
      const result = await client.executeQuery(Array.isArray(sql) ? finalStatements : finalStatements[0])
      return trimResponse(trimReportEnvelope(result))
    },
  }),
]
