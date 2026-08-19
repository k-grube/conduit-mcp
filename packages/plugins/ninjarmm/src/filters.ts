// device filter (df) syntax reference for NinjaRMM tools
export const DF_DESCRIPTION =
  'Device filter expression. Syntax: org=ID, location=ID, id=ID, role=ID, class=TYPE, status=STATE. ' +
  'Operators: =, !=, in(), nin(). Combine with and/or/not. ' +
  'Examples: "org = 5", "id in (100,200)", "org = 5 and class = WINDOWS_WORKSTATION". ' +
  'Classes: WINDOWS_SERVER, WINDOWS_WORKSTATION, LINUX_SERVER, LINUX_WORKSTATION, MAC, MAC_SERVER. ' +
  'No software name filter, use the name param on ninja_query_software instead.'
