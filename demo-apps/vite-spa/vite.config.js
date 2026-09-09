import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Demo app (M12): build tĩnh ra dist/, serve bằng vite preview hoặc nginx trên VPS.
export default defineConfig({
  plugins: [react()]
})
