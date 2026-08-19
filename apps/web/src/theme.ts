import { createTheme } from '@mui/material/styles'

// Modernist: flat, Archivo, zero radius, 2px rules, one red plus a green reserved for success.
// ramp steps taken verbatim from the design system's tokens
const neutral = {
  100: '#f8f4f4',
  200: '#eae7e7',
  300: '#d7d3d3',
  400: '#bab6b6',
  500: '#9b9797',
  600: '#7d7979',
  700: '#605d5d',
  800: '#444141',
  900: '#2d2b2b',
}

const accent = {
  100: '#fff2ef',
  200: '#ffe0d9',
  300: '#ffc4b8',
  400: '#ff9783',
  500: '#ff563c',
  600: '#dd2b0f',
  700: '#ae1800',
  800: '#7c1405',
  900: '#4d170e',
}

// success is the one departure from the one-red system, chips follow the error chip's dark-bg/light-text pattern
const green = {
  200: '#c9f0d3',
  300: '#9fe2b0',
  500: '#37b04f',
  700: '#1b7c33',
  900: '#12341c',
}

const INK = '#201e1d'
const GROUND = '#f3f2f2'

// on the light ground the accent is #ec3013; on the dark ground it is too dark
// against near-black, so the dark scheme steps up to accent-500.
// rules are text.primary at 0.4 alpha, hairlines at 0.2 (see MuiTableCell)
const RULE_DARK = 'rgba(248, 244, 244, 0.4)'
const RULE_LIGHT = 'rgba(32, 30, 29, 0.4)'

const heading = {
  fontFamily: 'Archivo, system-ui, sans-serif',
  fontWeight: 800,
  lineHeight: 1.12,
  letterSpacing: '-0.015em',
}
const label = {
  fontFamily: 'Archivo, system-ui, sans-serif',
  fontWeight: 800,
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase' as const,
}

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  defaultColorScheme: 'dark',
  colorSchemes: {
    dark: {
      palette: {
        mode: 'dark',
        primary: { main: accent[500], dark: accent[600], light: accent[400], contrastText: INK },
        error: { main: accent[500], contrastText: INK },
        success: { main: green[500], contrastText: INK },
        warning: { main: accent[400], contrastText: INK },
        background: { default: INK, paper: neutral[900] },
        text: { primary: neutral[100], secondary: neutral[500], disabled: neutral[600] },
        divider: RULE_DARK,
      },
    },
    light: {
      palette: {
        mode: 'light',
        primary: { main: '#ec3013', dark: accent[700], light: accent[400], contrastText: GROUND },
        error: { main: '#ec3013', contrastText: GROUND },
        success: { main: green[700], contrastText: GROUND },
        warning: { main: accent[600], contrastText: GROUND },
        background: { default: GROUND, paper: '#eae9e9' },
        text: { primary: INK, secondary: neutral[700], disabled: neutral[500] },
        divider: RULE_LIGHT,
      },
    },
  },

  shape: { borderRadius: 0 },
  spacing: 4, // the --space-* scale is 4px-based

  typography: {
    fontFamily: 'Archivo, system-ui, sans-serif',
    fontSize: 15,
    h1: { ...heading, fontSize: 42 },
    h2: { ...heading, fontSize: 32 },
    h3: { ...heading, fontSize: 25 },
    h4: { ...heading, fontSize: 42 }, // the dashboard KPI numeral
    h5: { ...heading, fontSize: 20 },
    h6: { ...heading, fontSize: 18 },
    subtitle2: { ...label, fontSize: 11, color: neutral[500] },
    body1: { fontSize: 15, lineHeight: 1.55 },
    body2: { fontSize: 14, lineHeight: 1.55 },
    overline: label,
    button: {
      fontFamily: 'Archivo, system-ui, sans-serif',
      fontWeight: 800,
      fontSize: 14,
      lineHeight: 1.2,
      letterSpacing: 0,
      textTransform: 'none',
    },
  },

  // flat system: anything that must float above the page uses a 2px rule or the paper step
  shadows: [
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
  ],

  components: {
    MuiCssBaseline: {
      styleOverrides: `
        *:focus { outline: none; }
        *:focus-visible { outline: 2px solid ${accent[500]}; outline-offset: 2px; }
        ::selection { background: rgba(255, 86, 60, 0.3); }
      `,
    },

    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: 'none' } },
    },

    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'transparent' },
      styleOverrides: {
        root: ({ theme }) => ({
          background: theme.vars.palette.background.default,
          borderBottom: `2px solid ${theme.vars.palette.divider}`,
        }),
      },
    },
    MuiToolbar: { styleOverrides: { root: { minHeight: 56, '@media (min-width:600px)': { minHeight: 56 } } } },

    MuiDrawer: {
      styleOverrides: {
        paper: ({ theme }) => ({
          background: theme.vars.palette.background.default,
          borderRight: `2px solid ${theme.vars.palette.divider}`,
          paddingTop: 8,
        }),
      },
    },

    MuiListItemButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          padding: '9px 20px',
          color: theme.vars.palette.text.secondary,
          '& .MuiListItemText-primary': { fontSize: 14 },
          '&:hover': { background: 'rgba(255, 86, 60, 0.1)' },
          '&.Mui-selected': {
            background: theme.vars.palette.primary.main,
            color: theme.vars.palette.primary.contrastText,
            '& .MuiListItemText-primary': { fontWeight: 800 },
            '&:hover': { background: theme.vars.palette.primary.light },
          },
        }),
      },
    },

    MuiButton: {
      defaultProps: { disableRipple: true, disableElevation: true },
      styleOverrides: {
        root: { padding: '8px 14px', minWidth: 0, justifyContent: 'flex-start' }, // labels flush left
        contained: ({ theme }) => ({
          background: theme.vars.palette.primary.main,
          '&:hover': { background: theme.vars.palette.primary.dark },
        }),
        outlined: ({ theme }) => ({
          borderColor: theme.vars.palette.divider,
          borderWidth: 1,
          color: theme.vars.palette.text.primary,
        }),
        text: ({ theme }) => ({ color: theme.vars.palette.primary.main }),
      },
    },
    MuiIconButton: { defaultProps: { disableRipple: true }, styleOverrides: { root: { borderRadius: 0 } } },

    MuiToggleButtonGroup: {
      styleOverrides: {
        root: ({ theme }) => ({ border: `1px solid ${theme.vars.palette.divider}` }),
        grouped: ({ theme }) => ({
          border: 0,
          borderLeft: `1px solid ${theme.vars.palette.divider}`,
          '&:first-of-type': { borderLeft: 0 },
        }),
      },
    },
    MuiToggleButton: {
      defaultProps: { disableRipple: true },
      styleOverrides: {
        root: ({ theme }) => ({
          padding: '7px 14px',
          fontSize: 13,
          fontWeight: 400,
          textTransform: 'none',
          color: theme.vars.palette.text.secondary,
          '&:hover': { background: 'rgba(255, 86, 60, 0.1)' },
          '&.Mui-selected': {
            background: theme.vars.palette.primary.main,
            color: theme.vars.palette.primary.contrastText,
            fontWeight: 600,
            '&:hover': { background: theme.vars.palette.primary.light },
          },
        }),
      },
    },

    MuiTable: { styleOverrides: { root: { borderCollapse: 'collapse' } } },
    MuiTableCell: {
      styleOverrides: {
        // hairline = rule at half strength, derived from the scheme's text color channel
        root: ({ theme }) => ({
          borderBottom: `1px solid rgba(${theme.vars.palette.text.primaryChannel} / 0.2)`,
          fontSize: 14,
        }),
        head: ({ theme }) => ({
          ...label,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.08em',
          color: theme.vars.palette.text.secondary,
          borderBottom: `2px solid ${theme.vars.palette.divider}`,
        }),
        sizeSmall: { padding: '9px 8px' },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: { '&.MuiTableRow-hover:hover': { background: 'rgba(248, 244, 244, 0.06)' } },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 0, height: 'auto', padding: '3px 10px', fontSize: 11, letterSpacing: '0.02em' },
        label: { padding: 0 },
        // label padding is 0, without this the x's default negative margin sits on the text
        deleteIcon: { margin: '0 -4px 0 4px' },
        colorSuccess: { background: green[900], color: green[300] },
        colorError: { background: accent[900], color: accent[300] },
        colorWarning: { background: accent[800], color: accent[200] },
        colorDefault: { background: neutral[800], color: neutral[100] },
      },
    },

    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          background: theme.vars.palette.background.paper,
          '& fieldset': { borderColor: theme.vars.palette.divider },
          '&:hover fieldset': { borderColor: theme.vars.palette.text.secondary },
          '&.Mui-focused fieldset': { borderWidth: 1, borderColor: theme.vars.palette.primary.main },
        }),
        input: { fontSize: 14 },
      },
    },
    MuiInputLabel: { styleOverrides: { root: { fontSize: 14 } } },

    MuiDialog: {
      styleOverrides: {
        paper: ({ theme }) => ({
          background: theme.vars.palette.background.paper,
          border: `2px solid ${theme.vars.palette.divider}`,
        }),
      },
    },
    MuiDialogTitle: { styleOverrides: { root: { ...heading, fontSize: 20 } } },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          variants: [
            {
              props: { severity: 'error', variant: 'standard' },
              style: { background: accent[900], color: accent[200] },
            },
          ],
        },
      },
    },
    MuiSwitch: { defaultProps: { disableRipple: true } },
    MuiTooltip: { styleOverrides: { tooltip: { borderRadius: 0, fontSize: 12 } } },
  },
})
