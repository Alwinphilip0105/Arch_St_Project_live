import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

if (process.env.NODE_ENV === 'development') {
  console.group('🏺 Arch Street Dashboard — Environment Check');
  console.log('Sheet URL:   ',
    process.env.REACT_APP_SHEET_CSV_URL
      ? '✅ Set' : '❌ Missing — add to .env');
  console.log('Identity:    ', 'Netlify Identity (configure on Netlify after deploy)');
  console.log('Sync interval:',
    process.env.REACT_APP_SYNC_INTERVAL || '86400000', 'ms');
  console.log('Debug mode:  ',
    process.env.REACT_APP_DEBUG || 'false');
  console.groupEnd();
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);
