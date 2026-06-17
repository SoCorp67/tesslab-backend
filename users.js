import { Router } from 'express'
import { supabase } from '../config/supabase.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'

const router = Router()

// GET /api/users — liste des membres (auth requise)
router.get('/', requireAuth, async (req, res) => {
  const { search, program, open_to_project, page = 1, limit = 20 } = req.query
  const offset = (page - 1) * limit

  let query = supabase
    .from('users')
    .select('id, full_name, avatar_url, bio, role, program, interests, skills, open_to_project, created_at')
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false })

  if (search) query = query.ilike('full_name', `%${search}%`)
  if (program) query = query.eq('program', program)
  if (open_to_project === 'true') query = query.eq('open_to_project', true)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ error: error.message })

  res.json({ users: data, total: count, page: Number(page), limit: Number(limit) })
})

// GET /api/users/:id — profil d'un membre
router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, avatar_url, bio, role, program, interests, skills, open_to_project, created_at')
    .eq('id', req.params.id)
    .single()

  if (error || !data) return res.status(404).json({ error: 'Membre non trouvé' })
  res.json({ user: data })
})

// PUT /api/users/me — mettre à jour son propre profil
router.put('/me', requireAuth, async (req, res) => {
  const allowedFields = ['full_name', 'bio', 'avatar_url', 'interests', 'skills', 'open_to_project', 'program']
  const updates = {}
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) updates[field] = req.body[field]
  }
  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ user: data })
})

// PUT /api/users/:id/role — changer le rôle (admin seulement)
router.put('/:id/role', requireAuth, requireAdmin, async (req, res) => {
  const { role } = req.body
  const validRoles = ['member', 'mentor', 'admin']
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Rôle invalide' })
  }

  const { data, error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ user: data })
})

export default router
