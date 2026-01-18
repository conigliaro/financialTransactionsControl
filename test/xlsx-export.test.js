import { describe, it, expect, vi } from 'vitest';

let lang = 'pt-BR';
const dict = {
  'pt-BR': {
    'xlsx.title': 'Controle de movimentação financeira',
    'xlsx.col.date': 'DATA:',
    'xlsx.col.docValue': 'VALOR DOC.',
    'xlsx.col.interest': 'JUROS/MULTAS',
    'xlsx.col.discount': 'DESCONTOS',
    'xlsx.col.paidValue': 'VALOR PAGO',
    'xlsx.col.expenseType': 'TIPO DA DESPESA',
    'xlsx.col.vendor': 'FORNECEDOR',
    'xlsx.label.company': 'Empresa:',
    'xlsx.label.period': 'Período:',
  },
  es: {
    'xlsx.title': 'Control de movimientos financieros',
    'xlsx.col.date': 'FECHA:',
    'xlsx.col.paidValue': 'VALOR PAGADO',
    'xlsx.label.company': 'Empresa:',
  },
};

vi.mock('../i18n/loader.js', () => ({
  t: (key) => dict[lang]?.[key] ?? key,
  __setLang: (next) => {
    lang = next;
  },
}));

import * as i18n from '../i18n/loader.js';
import { buildXlsxEntries, generateXlsxBuffer } from '../utils/xlsx-export.js';
import '../components/ll-export-dialog.js';

describe('XLSX export (template-like)', () => {
  it('builds expected worksheet XML structure', () => {
    i18n.__setLang('pt-BR');
    const entries = buildXlsxEntries({
      movements: [
        {
          id: 'm1',
          date: '2026-01-18',
          docValue: 100,
          interest: 1,
          discount: 2,
          paidValue: 99,
          expenseType: 'Food',
          vendor: 'Acme',
        },
      ],
      companyName: 'ACME LLC',
      month: 1,
      year: 2026,
      currencyCode: 'EUR',
    });

    const sheet = entries.find((e) => e.path === 'xl/worksheets/sheet1.xml')?.data;
    expect(sheet).toContain('Controle de movimentação financeira');
    expect(sheet).toContain('Empresa: ACME LLC');
    expect(sheet).toContain('<mergeCell ref="A1:E1"/>');
    expect(sheet).toContain('<mergeCell ref="F1:G1"/>');
    expect(sheet).toContain('DATA:');
    expect(sheet).toContain('VALOR PAGO');
    expect(sheet).toContain('TIPO DA DESPESA');
    expect(sheet).toContain('FORNECEDOR');
  });

  it('produces a valid ZIP container (PK header)', async () => {
    const buf = await generateXlsxBuffer({
      movements: [],
      companyName: 'X',
      month: 1,
      year: 2026,
      currencyCode: 'EUR',
    });
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(String.fromCharCode(buf[0], buf[1])).toBe('PK');
  });

  it('localizes title and headers in Spanish (spot check)', () => {
    i18n.__setLang('es');
    const entries = buildXlsxEntries({
      movements: [],
      companyName: 'ACME',
      month: 1,
      year: 2026,
      currencyCode: 'EUR',
    });
    const sheet = entries.find((e) => e.path === 'xl/worksheets/sheet1.xml')?.data;
    expect(sheet).toContain('Control de movimientos financieros');
    expect(sheet).toContain('FECHA:');
    expect(sheet).toContain('VALOR PAGADO');
  });
});

describe('Export dialog UI', () => {
  it('renders Empresa and Período and enables XLSX button', () => {
    const el = document.createElement('ll-export-dialog');
    document.body.appendChild(el);

    el.setInfo({ companyName: 'ACME LLC', period: '01/2026' });

    const company = el.shadowRoot.getElementById('company-name-display')?.textContent;
    const period = el.shadowRoot.getElementById('period-display')?.textContent;
    const xlsxBtn = el.shadowRoot.getElementById('export-xlsx-btn');

    expect(company).toBe('ACME LLC');
    expect(period).toBe('01/2026');
    expect(xlsxBtn.disabled).toBe(false);
  });
});
