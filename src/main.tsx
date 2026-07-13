import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { DesignGallery } from './design/DesignGallery'
import { ThemeGallery } from './design/ThemeGallery'
import './index.css'

// `#design`=レイアウト比較 / `#tones`=カラートーン比較 / それ以外=本体アプリ。
// hashchange に反応（同一ドキュメントのハッシュ変更でも切り替わる）。
function Root() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (hash.startsWith('#design')) return <DesignGallery />
  if (hash.startsWith('#tones')) return <ThemeGallery />
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
