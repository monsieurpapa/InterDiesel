import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';
import './styles.css';

render(<App />, document.getElementById('app')!);

// Service worker: caches the app so it opens with no network. New versions are
// installed in the background and used on the next start.
registerSW({ immediate: true });
