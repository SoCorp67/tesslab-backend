import { Router } from 'express'
import { supabase } from '../config/supabase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// GET /api/messages/conversations — mes conversations
router.get('/conversations', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('conversation_participants')
    .select(`
      conversation:conversations(
        id,
        created_at,
        participants:conversation_participants(
          user:users(id, full_name, avatar_url)
        )
      )
    `)
    .eq('user_id', req.user.id)

  if (error) return res.status(500).json({ error: error.message })

  // Enrichir avec le dernier message
  const conversations = await Promise.all(
    (data || []).map(async ({ conversation }) => {
      const { data: lastMsg } = await supabase
        .from('messages')
        .select('content, created_at, sender:users(full_name)')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      const { count: unread } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conversation.id)
        .is('read_at', null)
        .neq('sender_id', req.user.id)

      return { ...conversation, last_message: lastMsg, unread_count: unread || 0 }
    })
  )

  res.json({ conversations })
})

// POST /api/messages/conversations — démarrer une conversation
router.post('/conversations', requireAuth, async (req, res) => {
  const { recipient_id } = req.body
  if (!recipient_id) return res.status(400).json({ error: 'Destinataire requis' })
  if (recipient_id === req.user.id) {
    return res.status(400).json({ error: 'Impossible de vous envoyer un message à vous-même' })
  }

  // Vérifier si une conversation existe déjà entre ces deux personnes
  const { data: existing } = await supabase.rpc('find_conversation', {
    user1: req.user.id,
    user2: recipient_id
  })

  if (existing && existing.length > 0) {
    return res.json({ conversation_id: existing[0].conversation_id, existing: true })
  }

  // Créer la conversation
  const { data: conv } = await supabase
    .from('conversations').insert({}).select().single()

  await supabase.from('conversation_participants').insert([
    { conversation_id: conv.id, user_id: req.user.id },
    { conversation_id: conv.id, user_id: recipient_id }
  ])

  res.status(201).json({ conversation_id: conv.id, existing: false })
})

// GET /api/messages/conversations/:id — messages d'une conversation
router.get('/conversations/:id', requireAuth, async (req, res) => {
  const { page = 1, limit = 50 } = req.query
  const offset = (page - 1) * limit

  // Vérifier que l'user fait partie de la conversation
  const { data: participant } = await supabase
    .from('conversation_participants')
    .select('*')
    .eq('conversation_id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (!participant) return res.status(403).json({ error: 'Accès refusé' })

  const { data, error } = await supabase
    .from('messages')
    .select('*, sender:users(id, full_name, avatar_url)')
    .eq('conversation_id', req.params.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return res.status(500).json({ error: error.message })

  // Marquer les messages comme lus
  await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', req.params.id)
    .is('read_at', null)
    .neq('sender_id', req.user.id)

  res.json({ messages: data.reverse(), page: Number(page) })
})

// POST /api/messages/conversations/:id — envoyer un message
router.post('/conversations/:id', requireAuth, async (req, res) => {
  const { content } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'Message vide' })

  const { data: participant } = await supabase
    .from('conversation_participants')
    .select('*')
    .eq('conversation_id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (!participant) return res.status(403).json({ error: 'Accès refusé' })

  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: req.params.id,
      sender_id: req.user.id,
      content: content.trim()
    })
    .select('*, sender:users(id, full_name, avatar_url)')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ message: data })
})

export default router
