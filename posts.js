import { Router } from 'express'
import { supabase } from '../config/supabase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// GET /api/posts — fil d'actualité global ou par groupe
router.get('/', requireAuth, async (req, res) => {
  const { group_id, type, page = 1, limit = 20 } = req.query
  const offset = (page - 1) * limit

  let query = supabase
    .from('posts')
    .select(`
      *,
      author:users(id, full_name, avatar_url, role),
      group:groups(id, name)
    `)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (group_id) query = query.eq('group_id', group_id)
  if (type) query = query.eq('type', type)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })

  res.json({ posts: data, page: Number(page), limit: Number(limit) })
})

// POST /api/posts — créer un post
router.post('/', requireAuth, async (req, res) => {
  const { content, group_id, media_urls, type = 'post' } = req.body

  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'Contenu requis' })
  }

  const { data, error } = await supabase
    .from('posts')
    .insert({
      author_id: req.user.id,
      content: content.trim(),
      group_id: group_id || null,
      media_urls: media_urls || [],
      type
    })
    .select(`
      *,
      author:users(id, full_name, avatar_url, role)
    `)
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ post: data })
})

// GET /api/posts/:id — un post avec ses commentaires
router.get('/:id', requireAuth, async (req, res) => {
  const { data: post, error } = await supabase
    .from('posts')
    .select(`
      *,
      author:users(id, full_name, avatar_url, role),
      group:groups(id, name)
    `)
    .eq('id', req.params.id)
    .single()

  if (error || !post) return res.status(404).json({ error: 'Post non trouvé' })

  const { data: comments } = await supabase
    .from('post_comments')
    .select('*, author:users(id, full_name, avatar_url)')
    .eq('post_id', req.params.id)
    .order('created_at', { ascending: true })

  res.json({ post, comments: comments || [] })
})

// PUT /api/posts/:id — modifier son post
router.put('/:id', requireAuth, async (req, res) => {
  const { content, media_urls } = req.body

  const { data: existing } = await supabase
    .from('posts').select('author_id').eq('id', req.params.id).single()

  if (!existing) return res.status(404).json({ error: 'Post non trouvé' })
  if (existing.author_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Non autorisé' })
  }

  const { data, error } = await supabase
    .from('posts')
    .update({ content, media_urls, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ post: data })
})

// DELETE /api/posts/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const { data: existing } = await supabase
    .from('posts').select('author_id').eq('id', req.params.id).single()

  if (!existing) return res.status(404).json({ error: 'Post non trouvé' })
  if (existing.author_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Non autorisé' })
  }

  await supabase.from('posts').delete().eq('id', req.params.id)
  res.json({ message: 'Post supprimé' })
})

// POST /api/posts/:id/like — liker/unliker
router.post('/:id/like', requireAuth, async (req, res) => {
  const postId = req.params.id
  const userId = req.user.id

  const { data: existing } = await supabase
    .from('post_likes')
    .select('*')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .single()

  if (existing) {
    await supabase.from('post_likes').delete()
      .eq('post_id', postId).eq('user_id', userId)
    await supabase.from('posts').update({ likes_count: supabase.rpc('decrement', { x: 1 }) })
      .eq('id', postId)
    return res.json({ liked: false })
  }

  await supabase.from('post_likes').insert({ post_id: postId, user_id: userId })
  await supabase.rpc('increment_likes', { post_id: postId })
  res.json({ liked: true })
})

// POST /api/posts/:id/comments — commenter
router.post('/:id/comments', requireAuth, async (req, res) => {
  const { content } = req.body
  if (!content) return res.status(400).json({ error: 'Contenu requis' })

  const { data, error } = await supabase
    .from('post_comments')
    .insert({ post_id: req.params.id, author_id: req.user.id, content })
    .select('*, author:users(id, full_name, avatar_url)')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ comment: data })
})

export default router
