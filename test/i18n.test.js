import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocking fetch
global.fetch = vi.fn();

async function mockLoader(lang, data) {
    vi.resetModules(); // Reset modules to re-import the loader with new mocks
    
    // Mock fetch before importing the loader
    global.fetch = vi.fn(async (url) => {
        const requestedLang = url.split('/').pop().replace('.js', '');
        if (requestedLang === lang) {
            return {
                ok: true,
                // Dynamic import() in Node test env will evaluate this string.
                text: () => `export default ${JSON.stringify(data)}`,
            };
        }
        if (requestedLang === 'en') {
             return {
                ok: true,
                text: () => `export default ${JSON.stringify({ 'company.name': 'Company Name' })}`,
            };
        }
        return { ok: false };
    });
    
    return await import('../i18n/loader.js');
}


describe('i18n System', () => {
    
  beforeEach(() => {
    // Reset navigator properties for each test
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
    Object.defineProperty(navigator, 'languages', { value: ['en-US', 'en'], configurable: true });
  });

  it('should detect preferred language (es)', async () => {
    Object.defineProperty(navigator, 'languages', { value: ['es-ES', 'es'], configurable: true });
    
    const esTranslations = { 'company.name': 'Nombre de la Empresa' };
    const { loadTranslations, t, getBrowserLang } = await mockLoader('es', esTranslations);

    await loadTranslations();
    
    expect(getBrowserLang()).toBe('es');
    expect(t('company.name')).toBe('Nombre de la Empresa');
  });

  it('should fallback to English if language is not supported', async () => {
    Object.defineProperty(navigator, 'languages', { value: ['fr-FR', 'fr'], configurable: true });

    const { loadTranslations, t, getBrowserLang } = await mockLoader('fr', {});
    await loadTranslations();
    
    expect(getBrowserLang()).toBe('en');
    expect(t('company.name')).toBe('Company Name');
  });

  it('should handle pt-BR correctly', async () => {
    Object.defineProperty(navigator, 'languages', { value: ['pt-BR', 'pt'], configurable: true });

    const ptBRTranslations = { 'company.name': 'Nome da Empresa' };
    const { loadTranslations, t, getBrowserLang } = await mockLoader('pt-BR', ptBRTranslations);
    await loadTranslations();
    
    expect(getBrowserLang()).toBe('pt-BR');
    expect(t('company.name')).toBe('Nome da Empresa');
  });
});
