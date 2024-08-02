import { createApp } from 'vue'
import App from './App.vue'
import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import { createPinia } from 'pinia'
import { en, de } from './locales'
import { createVueI18nAdapter } from 'vuetify/locale/adapters/vue-i18n'
import { createI18n, useI18n } from 'vue-i18n'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import './main.css'
import 'roboto-fontface/css/roboto/roboto-fontface.css'
import '@mdi/font/css/materialdesignicons.css'

const i18n = createI18n({
  legacy: false, // Vuetify does not support the legacy mode of vue-i18n
  locale: 'en',
  globalInjection: true,
  fallbackLocale: 'de',
  messages: {
    en,
    de
  }
})

const vuetify = createVuetify({
  components,
  directives,
  locale: {
    adapter: createVueI18nAdapter({ i18n, useI18n })
  },
  theme: {
    themes: {
      light: {
        dark: false,
        colors: {
          primary: '#534b67',
          secondary: '#c7ae7f',
          accent: '#ff8649',
          error: '#e62828',
          info: '#98a6ac',
          success: '#49a078',
          warning: '#334d5c'
        }
      },
      dark: {
        dark: true,
        colors: {
          primary: '#534b67',
          secondary: '#c7ae7f',
          accent: '#ff8649',
          error: '#e62828',
          info: '#233543',
          success: '#49a078',
          warning: '#98a6ac'
        }
      }
    }
  }
})

const app = createApp(App)
const pinia = createPinia()

app.use(i18n)
app.use(vuetify)
app.use(pinia)

app.mount('#app')
