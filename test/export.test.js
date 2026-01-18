import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinancieApp } from '../financie-app.js';
import { db } from '../db/indexeddb.js';

// Mock dependencies
vi.mock('../db/indexeddb.js', () => ({
    db: {
        getAll: vi.fn(),
    }
}));
vi.mock('../i18n/loader.js', () => ({
  loadTranslations: vi.fn(),
  setLanguage: vi.fn(),
  getActiveLang: () => 'en',
  t: (key) => key,
}));


describe('Export Functionality', () => {

  beforeEach(() => {
    // Mock the DOM manipulation in the constructor
    document.body.innerHTML = `
        <ll-app>
            <ll-header></ll-header>
            <ll-movement-list></ll-movement-list>
        </ll-app>
    `;
  });

  it('should generate a correct CSV string', async () => {
    const movements = [
      {
        id: '1', date: '2024-01-01', docValue: 100, interest: 10, discount: 5, paidValue: 105, expenseType: 'Food', vendor: 'Supermarket', notes: '', status: 'draft',
      },
      {
        id: '2', date: '2024-01-02', docValue: 200, interest: 0, discount: 20, paidValue: 180, expenseType: 'Transport', vendor: 'Gas Station', notes: 'trip', status: 'sent',
      },
    ];
    db.getAll.mockResolvedValue(movements);

    // Instantiate the app to get access to its methods
    const app = new FinancieApp();
    
    // Mock the link creation to intercept the generated URI
    let generatedUri;
    const link = { setAttribute: (attr, val) => { if(attr === 'href') generatedUri = val; }, click: () => {} };
    vi.spyOn(document, 'createElement').mockReturnValue(link);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => {});

    await app.exportCSV();

    const expectedHeader = "DATA;VALOR DOC.;JUROS/MULTAS;DESCONTOS;VALOR PAGO;TIPO DA DESPESA;FORNECEDOR;TYPE\n";
    const expectedRow1 = "2024-01-01;100;10;5;105;Food;Supermarket;expense";
    const expectedRow2 = "2024-01-02;200;0;20;180;Transport;Gas Station;expense";
    
    const decodedUri = decodeURI(generatedUri);
    const csvContent = decodedUri.replace('data:text/csv;charset=utf-8,', '');
    const [header, row1, row2] = csvContent.split('\n');

    expect(header + `\n`).toBe(expectedHeader);
    expect(row1).toBe(expectedRow1);
    expect(row2).toBe(expectedRow2);
  });
});
