import { Router } from 'express'
import { supabase } from '../config/supabase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// GET /api/projects — liste des projets
router.get('/', requireAuth, async (req, res) => {
  const { status, category, open_only, search, page = 1, limit = 20 } = req.query
  const offset = (page - 1) * limit

  let query = supabase
    .from('projects')
    .select(`
      *,
      owner:users(id, full_name, avatar_url),
      members:project_members(user:users(id, full_name, avatar_url))
    `)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (category) query = query.eq('category', category)
  if (open_only === 'true') query = query.eq('is_open', true)
  if (search) query = query.ilike('title', `%${search}%`)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })

  res.json({ projects: data, page: Number(page), limit: Number(limit) })
})

// POST /api/projects — créer une fiche projet
router.post('/', requireAuth, async (req, res) => {
  const { title, description, skills_needed, category, is_open = true } = req.body

  if (!title) return res.status(400).json({ error: 'Titre requis' })

  const { data, error } = await supabase
    .from('projects')
    .insert({
      owner_id: req.user.id,
      title,
      description,
      skills_needed: skills_needed || [],
      category,
      is_open,
      status: 'idea'
    })
    .select(`*, owner:users(id, full_name, avatar_url)`)
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ project: data })
})

// GET /api/projects/:id — détail d'un projet
router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('projects')
    .select(`
      *,
      owner:users(id, full_name, avatar_url, bio),
      members:project_members(user:users(id, full_name, avatar_url))
    `)
    .eq('id', req.params.id)
    .single()

  if (error || !data) return res.status(404).json({ error: 'Projet non trouvé' })
  res.json({ project: data })
})

// PUT /api/projects/:id — modifier un projet
router.put('/:id', requireAuth, async (req, res) => {
  const { data: existing } = await supabase
    .from('projects').select('owner_id').eq('id', req.params.id).single()

  if (!existing) return res.status(404).json({ error: 'Projet non trouvé' })
  if (existing.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Non autorisé' })
  }

  const allowed = ['title', 'description', 'skills_needed', 'category', 'status', 'is_open']
  const updates = {}
  for (const field of allowed) {
    if (req.body[field] !== undefined) updates[field] = req.body[field]
  }
  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('projects').update(updates).eq('id', req.params.id)
    .select(`*, owner:users(id, full_name, avatar_url)`)
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ project: data })
})

// DELETE /api/projects/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const { data: existing } = await supabase
    .from('projects').select('owner_id').eq('id', req.params.id).single()

  if (!existing) return res.status(404).json({ error: 'Projet non trouvé' })
  if (existing.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Non autorisé' })
  }

  await supabase.from('projects').delete().eq('id', req.params.id)
  res.json({ message: 'Projet supprimé' })
})

// POST /api/projects/:id/join — rejoindre un projet
router.post('/:id/join', requireAuth, async (req, res) => {
  const { data: project } = await supabase
    .from('projects').select('is_open, owner_id').eq('id', req.params.id).single()

  if (!project) return res.status(404).json({ error: 'Projet non trouvé' })
  if (!project.is_open) return res.status(403).json({ error: 'Ce projet ne recrute plus' })
  if (project.owner_id === req.user.id) {
    return res.status(400).json({ error: 'Vous êtes déjà le créateur de ce projet' })
  }

  const { error } = await supabase
    .from('project_members')
    .insert({ project_id: req.params.id, user_id: req.user.id })

  if (error?.code === '23505') {
    return res.status(400).json({ error: 'Vous participez déjà à ce projet' })
  }
  if (error) return res.status(500).json({ error: error.message })

  res.json({ message: 'Vous avez rejoint le projet' })
})

export default router
