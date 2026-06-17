import { Router } from 'express'
import { supabase } from '../config/supabase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// POST /api/auth/register
// Inscription sur invitation (admin crée le compte)
router.post('/register', async (req, res) => {
  const { email, password, full_name, program } = req.body

  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'Email, mot de passe et nom requis' })
  }

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  })

  if (authError) return res.status(400).json({ error: authError.message })

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .insert({
      id: authData.user.id,
      email,
      full_name,
      program: program || null,
      role: 'member'
    })
    .select()
    .single()

  if (profileError) return res.status(500).json({ error: profileError.message })

  res.status(201).json({ user: profile })
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return res.status(401).json({ error: 'Email ou mot de passe incorrect' })

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', data.user.id)
    .single()

  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    user: profile
  })
})

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  await supabase.auth.signOut()
  res.json({ message: 'Déconnecté avec succès' })
})

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

export default router
