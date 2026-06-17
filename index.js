import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

dotenv.config()

// ── Clients ───────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── App ───────────────────────────────────────────────────
const app = express()
const PORT = process.env.PORT || 3000

app.use(helmet())
app.use(cors({ origin: '*', credentials: true }))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 })
app.use(limiter)

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 })

// ── Middleware Auth ───────────────────────────────────────
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' })
  }
  const token = authHeader.split(' ')[1]
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    return res.status(401).json({ error: 'Token invalide ou expiré' })
  }
  const { data: profile } = await supabase
    .from('users').select('*').eq('id', user.id).single()
  req.user = profile || user
  next()
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Accès admin requis' })
  }
  next()
}

// ══════════════════════════════════════════════════════════
// HEALTH CHECK
// ══════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'TESSLAB API', version: '1.0.0' })
})

// ══════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { email, password, full_name, program } = req.body
  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'Email, mot de passe et nom requis' })
  }
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true
  })
  if (authError) return res.status(400).json({ error: authError.message })

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .insert({ id: authData.user.id, email, full_name, program: program || null, role: 'member' })
    .select().single()

  if (profileError) return res.status(500).json({ error: profileError.message })
  res.status(201).json({ user: profile })
})

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return res.status(401).json({ error: 'Email ou mot de passe incorrect' })

  const { data: profile } = await supabase
    .from('users').select('*').eq('id', data.user.id).single()

  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    user: profile
  })
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await supabase.auth.signOut()
  res.json({ message: 'Déconnecté' })
})

// ══════════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════════
app.get('/api/users', requireAuth, async (req, res) => {
  const { search, program, open_to_project, page = 1, limit = 20 } = req.query
  const offset = (page - 1) * limit

  let query = supabase
    .from('users')
    .select('id, full_name, avatar_url, bio, role, program, interests, skills, open_to_project, created_at')
    .range(offset, offset + Number(limit) - 1)
    .order('created_at', { ascending: false })

  if (search) query = query.ilike('full_name', `%${search}%`)
  if (program) query = query.eq('program', program)
  if (open_to_project === 'true') query = query.eq('open_to_project', true)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json({ users: data })
})

app.get('/api/users/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, avatar_url, bio, role, program, interests, skills, open_to_project, created_at')
    .eq('id', req.params.id).single()

  if (error || !data) return res.status(404).json({ error: 'Membre non trouvé' })
  res.json({ user: data })
})

app.put('/api/users/me', requireAuth, async (req, res) => {
  const allowed = ['full_name', 'bio', 'avatar_url', 'interests', 'skills', 'open_to_project', 'program']
  const updates = {}
  for (const field of allowed) {
    if (req.body[field] !== undefined) updates[field] = req.body[field]
  }
  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('users').update(updates).eq('id', req.user.id).select().single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ user: data })
})

// ══════════════════════════════════════════════════════════
// POSTS
// ══════════════════════════════════════════════════════════
app.get('/api/posts', requireAuth, async (req, res) => {
  const { group_id, page = 1, limit = 20 } = req.query
  const offset = (page - 1) * limit

  let query = supabase
    .from('posts')
    .select('*, author:users(id, full_name, avatar_url, role), group:groups(id, name)')
    .order('created_at', { ascending: false })
    .range(offset, offset + Number(limit) - 1)

  if (group_id) query = query.eq('group_id', group_id)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json({ posts: data })
})

app.post('/api/posts', requireAuth, async (req, res) => {
  const { content, group_id, media_urls, type = 'post' } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'Contenu requis' })

  const { data, error } = await supabase
    .from('posts')
    .insert({ author_id: req.user.id, content: content.trim(), group_id: group_id || null, media_urls: media_urls || [], type })
    .select('*, author:users(id, full_name, avatar_url, role)').single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ post: data })
})

app.get('/api/posts/:id', requireAuth, async (req, res) => {
  const { data: post, error } = await supabase
    .from('posts')
    .select('*, author:users(id, full_name, avatar_url, role)')
    .eq('id', req.params.id).single()

  if (error || !post) return res.status(404).json({ error: 'Post non trouvé' })

  const { data: comments } = await supabase
    .from('post_comments')
    .select('*, author:users(id, full_name, avatar_url)')
    .eq('post_id', req.params.id)
    .order('created_at', { ascending: true })

  res.json({ post, comments: comments || [] })
})

app.delete('/api/posts/:id', requireAuth, async (req, res) => {
  const { data: existing } = await supabase
    .from('posts').select('author_id').eq('id', req.params.id).single()

  if (!existing) return res.status(404).json({ error: 'Post non trouvé' })
  if (existing.author_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Non autorisé' })
  }
  await supabase.from('posts').delete().eq('id', req.params.id)
  res.json({ message: 'Post supprimé' })
})

app.post('/api/posts/:id/comments', requireAuth, async (req, res) => {
  const { content } = req.body
  if (!content) return res.status(400).json({ error: 'Contenu requis' })

  const { data, error } = await supabase
    .from('post_comments')
    .insert({ post_id: req.params.id, author_id: req.user.id, content })
    .select('*, author:users(id, full_name, avatar_url)').single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ comment: data })
})

// ══════════════════════════════════════════════════════════
// PROJETS
// ══════════════════════════════════════════════════════════
app.get('/api/projects', requireAuth, async (req, res) => {
  const { status, open_only, search, page = 1, limit = 20 } = req.query
  const offset = (page - 1) * limit

  let query = supabase
    .from('projects')
    .select('*, owner:users(id, full_name, avatar_url)')
    .order('created_at', { ascending: false })
    .range(offset, offset + Number(limit) - 1)

  if (status) query = query.eq('status', status)
  if (open_only === 'true') query = query.eq('is_open', true)
  if (search) query = query.ilike('title', `%${search}%`)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json({ projects: data })
})

app.post('/api/projects', requireAuth, async (req, res) => {
  const { title, description, skills_needed, category, is_open = true } = req.body
  if (!title) return res.status(400).json({ error: 'Titre requis' })

  const { data, error } = await supabase
    .from('projects')
    .insert({ owner_id: req.user.id, title, description, skills_needed: skills_needed || [], category, is_open, status: 'idea' })
    .select('*, owner:users(id, full_name, avatar_url)').single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ project: data })
})

app.get('/api/projects/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('projects')
    .select('*, owner:users(id, full_name, avatar_url, bio)')
    .eq('id', req.params.id).single()

  if (error || !data) return res.status(404).json({ error: 'Projet non trouvé' })
  res.json({ project: data })
})

app.put('/api/projects/:id', requireAuth, async (req, res) => {
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
    .select('*, owner:users(id, full_name, avatar_url)').single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ project: data })
})

app.post('/api/projects/:id/join', requireAuth, async (req, res) => {
  const { data: project } = await supabase
    .from('projects').select('is_open, owner_id').eq('id', req.params.id).single()

  if (!project) return res.status(404).json({ error: 'Projet non trouvé' })
  if (!project.is_open) return res.status(403).json({ error: 'Ce projet ne recrute plus' })

  const { error } = await supabase
    .from('project_members')
    .insert({ project_id: req.params.id, user_id: req.user.id })

  if (error?.code === '23505') return res.status(400).json({ error: 'Déjà membre de ce projet' })
  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Vous avez rejoint le projet' })
})

// ══════════════════════════════════════════════════════════
// MATCHING IA
// ══════════════════════════════════════════════════════════
app.get('/api/matches', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('ai_matches')
    .select('*, project:projects(id, title, description, skills_needed, category, owner:users(full_name, avatar_url))')
    .eq('user_id', req.user.id)
    .order('score', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json({ matches: data || [] })
})

app.post('/api/matches/generate', requireAuth, async (req, res) => {
  const { data: user } = await supabase
    .from('users').select('full_name, interests, skills, program, bio')
    .eq('id', req.user.id).single()

  const { data: projects } = await supabase
    .from('projects').select('id, title, description, skills_needed, category')
    .eq('is_open', true).limit(30)

  if (!projects || projects.length === 0) {
    return res.json({ matches: [], message: 'Aucun projet disponible pour le moment' })
  }

  const prompt = `Tu es un assistant de matching pour TESSLAB, une association d'innovation sociale à Strasbourg.

Profil du membre :
- Nom : ${user.full_name}
- Programme : ${user.program || 'non précisé'}
- Intérêts : ${user.interests?.join(', ') || 'non précisés'}
- Compétences : ${user.skills?.join(', ') || 'non précisées'}
- Bio : ${user.bio || 'non précisée'}

Projets disponibles :
${projects.map((p, i) => `${i + 1}. [${p.id}] "${p.title}" — ${p.description || ''} — Compétences: ${p.skills_needed?.join(', ') || 'toutes'}`).join('\n')}

Retourne UNIQUEMENT un JSON valide sans markdown, les 5 meilleurs projets :
[{"project_id":"uuid","score":0.95,"reason":"explication courte"}]
Score entre 0 et 1. Ne retourne que les projets avec score > 0.5.`

  let matches = []
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
    matches = JSON.parse(response.content[0].text.trim())
  } catch (e) {
    return res.status(500).json({ error: 'Erreur IA, réessaie dans un moment' })
  }

  await supabase.from('ai_matches').delete().eq('user_id', req.user.id)

  const toInsert = matches
    .filter(m => m.score > 0.5 && m.project_id)
    .map(m => ({ user_id: req.user.id, project_id: m.project_id, score: m.score, reason: m.reason, seen: false }))

  if (toInsert.length > 0) {
    await supabase.from('ai_matches').insert(toInsert)
  }

  res.json({ matches: toInsert, message: `${toInsert.length} projet(s) suggéré(s)` })
})

// ══════════════════════════════════════════════════════════
// MESSAGERIE
// ══════════════════════════════════════════════════════════
app.get('/api/messages/conversations', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('conversation_participants')
    .select('conversation:conversations(id, created_at, participants:conversation_participants(user:users(id, full_name, avatar_url)))')
    .eq('user_id', req.user.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ conversations: data?.map(d => d.conversation) || [] })
})

app.post('/api/messages/conversations', requireAuth, async (req, res) => {
  const { recipient_id } = req.body
  if (!recipient_id) return res.status(400).json({ error: 'Destinataire requis' })

  const { data: conv } = await supabase.from('conversations').insert({}).select().single()
  await supabase.from('conversation_participants').insert([
    { conversation_id: conv.id, user_id: req.user.id },
    { conversation_id: conv.id, user_id: recipient_id }
  ])
  res.status(201).json({ conversation_id: conv.id })
})

app.get('/api/messages/conversations/:id', requireAuth, async (req, res) => {
  const { data: participant } = await supabase
    .from('conversation_participants')
    .select('*').eq('conversation_id', req.params.id).eq('user_id', req.user.id).single()

  if (!participant) return res.status(403).json({ error: 'Accès refusé' })

  const { data, error } = await supabase
    .from('messages')
    .select('*, sender:users(id, full_name, avatar_url)')
    .eq('conversation_id', req.params.id)
    .order('created_at', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })
  res.json({ messages: data || [] })
})

app.post('/api/messages/conversations/:id', requireAuth, async (req, res) => {
  const { content } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'Message vide' })

  const { data: participant } = await supabase
    .from('conversation_participants')
    .select('*').eq('conversation_id', req.params.id).eq('user_id', req.user.id).single()

  if (!participant) return res.status(403).json({ error: 'Accès refusé' })

  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: req.params.id, sender_id: req.user.id, content: content.trim() })
    .select('*, sender:users(id, full_name, avatar_url)').single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ message: data })
})

// ══════════════════════════════════════════════════════════
// COURS
// ══════════════════════════════════════════════════════════
app.get('/api/courses', requireAuth, async (req, res) => {
  const { category, level, search } = req.query

  let query = supabase
    .from('courses')
    .select('*, created_by:users(id, full_name, avatar_url)')
    .eq('is_published', true)
    .order('created_at', { ascending: false })

  if (category) query = query.eq('category', category)
  if (level) query = query.eq('level', level)
  if (search) query = query.ilike('title', `%${search}%`)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json({ courses: data || [] })
})

app.get('/api/courses/:id', requireAuth, async (req, res) => {
  const { data: course, error } = await supabase
    .from('courses')
    .select('*, created_by:users(id, full_name, avatar_url)')
    .eq('id', req.params.id).single()

  if (error || !course) return res.status(404).json({ error: 'Cours non trouvé' })

  const { data: lessons } = await supabase
    .from('lessons').select('*').eq('course_id', req.params.id).order('order_index')

  res.json({ course, lessons: lessons || [] })
})

app.post('/api/courses', requireAuth, async (req, res) => {
  if (!['admin', 'mentor'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Réservé aux mentors et admins' })
  }
  const { title, description, thumbnail_url, category, level } = req.body
  if (!title) return res.status(400).json({ error: 'Titre requis' })

  const { data, error } = await supabase
    .from('courses')
    .insert({ title, description, thumbnail_url, category, level, created_by: req.user.id, is_published: false })
    .select().single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ course: data })
})

app.post('/api/courses/:courseId/lessons/:lessonId/complete', requireAuth, async (req, res) => {
  await supabase.from('course_progress').upsert({
    user_id: req.user.id,
    lesson_id: req.params.lessonId,
    completed: true,
    completed_at: new Date().toISOString()
  })
  res.json({ message: 'Leçon terminée' })
})

// ══════════════════════════════════════════════════════════
// GROUPES
// ══════════════════════════════════════════════════════════
app.get('/api/groups', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('groups')
    .select('*, created_by:users(id, full_name)')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json({ groups: data || [] })
})

app.post('/api/groups', requireAuth, async (req, res) => {
  const { name, description, type = 'topic', is_private = false } = req.body
  if (!name) return res.status(400).json({ error: 'Nom requis' })

  const { data, error } = await supabase
    .from('groups')
    .insert({ name, description, type, is_private, created_by: req.user.id })
    .select().single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ group: data })
})

app.post('/api/groups/:id/join', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('group_members')
    .insert({ group_id: req.params.id, user_id: req.user.id })

  if (error?.code === '23505') return res.status(400).json({ error: 'Déjà membre' })
  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Groupe rejoint' })
})

// ══════════════════════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════════════════════
app.get('/api/notifications', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('notifications')
    .select('*').eq('user_id', req.user.id)
    .order('created_at', { ascending: false }).limit(50)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ notifications: data || [] })
})

app.put('/api/notifications/:id/read', requireAuth, async (req, res) => {
  await supabase.from('notifications').update({ read: true })
    .eq('id', req.params.id).eq('user_id', req.user.id)
  res.json({ message: 'Notification lue' })
})

// ══════════════════════════════════════════════════════════
// ERREURS
// ══════════════════════════════════════════════════════════
app.use((req, res) => {
  res.status(404).json({ error: `Route introuvable : ${req.method} ${req.path}` })
})

app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Erreur serveur interne' })
})

// ══════════════════════════════════════════════════════════
// DÉMARRAGE
// ══════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`TESSLAB API démarrée sur le port ${PORT}`)
})

export default app
