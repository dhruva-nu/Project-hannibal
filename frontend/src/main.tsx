import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@copilotkit/react-ui/styles.css'
import './styles/tokens.css'
import './styles/globals.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
