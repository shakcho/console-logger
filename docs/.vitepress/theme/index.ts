import { h, resolveComponent } from 'vue';
import DefaultTheme from 'vitepress/theme';
import InteractiveDemo from './components/InteractiveDemo.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'home-hero-after': () => {
        const ClientOnly = resolveComponent('ClientOnly');
        return h('div', { class: 'demo-wrap demo-wrap-hero' }, [
          h(ClientOnly, null, { default: () => h(InteractiveDemo) }),
        ]);
      },
    }),
};
