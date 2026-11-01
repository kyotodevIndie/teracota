// Site do Teracota (VitePress). Português na raiz, inglês em /en/.
// Deploy: .github/workflows/docs.yml (GitHub Pages, junto com o site em apps/site), manual.
import { defineConfig, type DefaultTheme, type HeadConfig } from 'vitepress';

const REPO = 'https://github.com/kyotodevIndie/teracota';
// o site novo (apps/site) fica na raiz; a documentação, em /docs
const BASE = '/teracota/docs/';
const SITE = `https://kyotodevindie.github.io${BASE}`;
const OG_IMAGE = `${SITE}og.png`;

const ptSidebar: DefaultTheme.Sidebar = {
  '/guide/': [
    {
      text: 'Guia do usuário',
      items: [
        { text: 'Instalação', link: '/guide/installation' },
        { text: 'Usando a Tera', link: '/guide/usage' },
        { text: 'Claude Code', link: '/guide/claude-code' },
        { text: 'FAQ e problemas', link: '/guide/faq' },
      ],
    },
  ],
  '/dev/': [
    {
      text: 'Desenvolvimento',
      items: [
        { text: 'Contribuindo', link: '/dev/contributing' },
        { text: 'Arquitetura', link: '/dev/architecture' },
        { text: 'Integrações com agentes', link: '/dev/integrations' },
        { text: 'API local', link: '/dev/api' },
        { text: 'Criando skins', link: '/dev/skins' },
        { text: 'Arte do rig 2D', link: '/dev/rig-art' },
      ],
    },
  ],
};

const enSidebar: DefaultTheme.Sidebar = {
  '/en/guide/': [
    {
      text: 'User guide',
      items: [
        { text: 'Installation', link: '/en/guide/installation' },
        { text: 'Using Tera', link: '/en/guide/usage' },
        { text: 'Claude Code', link: '/en/guide/claude-code' },
        { text: 'FAQ & troubleshooting', link: '/en/guide/faq' },
      ],
    },
  ],
  '/en/dev/': [
    {
      text: 'Development',
      items: [
        { text: 'Contributing', link: '/en/dev/contributing' },
        { text: 'Architecture', link: '/en/dev/architecture' },
        { text: 'Agent integrations', link: '/en/dev/integrations' },
        { text: 'Local API', link: '/en/dev/api' },
        { text: 'Creating skins', link: '/en/dev/skins' },
      ],
    },
  ],
};

export default defineConfig({
  base: BASE,
  cleanUrls: true,
  lastUpdated: true,
  title: 'Teracota',
  sitemap: { hostname: SITE },

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: `${BASE}favicon.png` }],
    ['meta', { name: 'theme-color', content: '#B4532F' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Teracota' }],
    ['meta', { property: 'og:image', content: OG_IMAGE }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:image:alt', content: 'Tera, a chibi cat girl, jumping happily next to the word Teracota' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: OG_IMAGE }],
  ],

  /** Open Graph por página: título, descrição, URL e idioma */
  transformHead({ pageData, title, description }) {
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
    const url = `${SITE}${path}`;
    const en = pageData.relativePath.startsWith('en/');
    const tags: HeadConfig[] = [
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { property: 'og:locale', content: en ? 'en_US' : 'pt_BR' }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
      ['link', { rel: 'canonical', href: url }],
    ];
    return tags;
  },

  locales: {
    root: {
      label: 'Português',
      lang: 'pt-BR',
      description: 'Tera, uma gatinha de desktop que reage ao seu agente de código. Open source, roda na sua máquina.',
      themeConfig: {
        nav: [
          { text: 'Guia', link: '/guide/installation', activeMatch: '/guide/' },
          { text: 'Desenvolvimento', link: '/dev/contributing', activeMatch: '/dev/' },
          { text: 'Baixar', link: `${REPO}/releases/latest` },
        ],
        sidebar: ptSidebar,
        outline: { label: 'Nesta página', level: [2, 3] },
        docFooter: { prev: 'Anterior', next: 'Próxima' },
        lastUpdated: { text: 'Atualizado em' },
        editLink: { pattern: `${REPO}/edit/main/docs/:path`, text: 'Sugerir uma edição nesta página' },
        returnToTopLabel: 'Voltar ao topo',
        sidebarMenuLabel: 'Menu',
        darkModeSwitchLabel: 'Aparência',
        lightModeSwitchTitle: 'Mudar pro modo claro',
        darkModeSwitchTitle: 'Mudar pro modo escuro',
        langMenuLabel: 'Idioma',
        notFound: {
          title: 'Página não encontrada',
          quote: 'A Tera procurou em todo canto e não achou essa página.',
          linkText: 'Voltar pro início',
        },
        footer: {
          message: 'Código sob MIT · Arte da Tera © Thallys Morais, sob CC BY 4.0 · Projeto independente, não afiliado à Anthropic.',
        },
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      description: 'Tera, a desktop cat girl that reacts to your coding agent. Open source, runs on your machine.',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/en/guide/installation', activeMatch: '/en/guide/' },
          { text: 'Development', link: '/en/dev/contributing', activeMatch: '/en/dev/' },
          { text: 'Download', link: `${REPO}/releases/latest` },
        ],
        sidebar: enSidebar,
        editLink: { pattern: `${REPO}/edit/main/docs/:path`, text: 'Suggest an edit to this page' },
        footer: {
          message: 'Code under MIT · Tera artwork © Thallys Morais, under CC BY 4.0 · Independent project, not affiliated with Anthropic.',
        },
      },
    },
  },

  themeConfig: {
    logo: { src: '/icon.png', alt: 'Tera' },
    socialLinks: [{ icon: 'github', link: REPO }],
    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: 'Buscar', buttonAriaLabel: 'Buscar' },
              modal: {
                noResultsText: 'Nada encontrado para',
                resetButtonTitle: 'Limpar busca',
                footer: { selectText: 'abrir', navigateText: 'navegar', closeText: 'fechar' },
              },
            },
          },
        },
      },
    },
  },
});
