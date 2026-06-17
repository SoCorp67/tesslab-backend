import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'

import authRoutes from './routes/auth.js'
import usersRoutes from './routes/users.js'
import postsRoutes from './routes/posts.js'
import projectsRoutes from './routes/projects.js'
import matchesRoutes from './routes/matches.js'
import messagesRoutes from './routes/messages.js'
import coursesRoutes from './routes/courses.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

// ── Sécurité ──────────────────────────────────────────────
app.use(helmet())
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}))

// Rate limiting global
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Trop de requêtes, réessaie dans 15 minutes' }
})

// Rate limiting strict sur l'auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives de connexion' }
})

// ── Parsing ───────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// ── Santé ─────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'TESSLAB API', version: '1.0.0' })
})

// ── Routes ────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes)
app.use('/api/users', usersRoutes)
app.use('/api/posts', postsRoutes)
app.use('/api/projects', projectsRoutes)
app.use('/api/matches', matchesRoutes)
app.use('/api/messages', messagesRoutes)
app.use('/api/courses', coursesRoutes)

// ── Erreurs ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route introuvable : ${req.method} ${req.path}` })
})

app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Erreur serveur interne' })
})

// ── Démarrage ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   TESSLAB API démarrée              ║
  ║   http://localhost:${PORT}             ║
  ║   Env: ${process.env.NODE_ENV || 'development'}                  ║
  ╚══════════════════════════════════════╝
  `)
})

export default app
