import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { generateMatches, getUserMatches } from '../services/matching.js'
import { supabase } from '../config/supabase.js'

const router = Router()

// GET /api/matches — récupérer ses suggestions IA
router.get('/', requireAuth, async (req, res) => {
  try {
    const matches = await getUserMatches(req.user.id)
    res.json({ matches })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// POST /api/matches/generate — regénérer ses suggestions
router.post('/generate', requireAuth, async (req, res) => {
  try {
    const matches = await generateMatches(req.user.id)
    res.json({ matches, message: `${matches.length} projet(s) suggéré(s) pour toi` })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// PUT /api/matches/:id/seen — marquer comme vu
router.put('/:id/seen', requireAuth, async (req, res) => {
  await supabase
    .from('ai_matches')
    .update({ seen: true })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)

  res.json({ message: 'Marqué comme vu' })
})

export default router
