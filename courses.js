import { Router } from 'express'
import { supabase } from '../config/supabase.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'

const router = Router()

// GET /api/courses — liste des cours publiés
router.get('/', requireAuth, async (req, res) => {
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

  // Enrichir avec le nombre de leçons et la progression
  const enriched = await Promise.all(
    data.map(async (course) => {
      const { count: lessons_count } = await supabase
        .from('lessons').select('*', { count: 'exact', head: true })
        .eq('course_id', course.id)

      const { count: completed_count } = await supabase
        .from('course_progress').select('*', { count: 'exact', head: true })
        .eq('user_id', req.user.id)
        .eq('completed', true)
        .in('lesson_id',
          (await supabase.from('lessons').select('id').eq('course_id', course.id))
            .data?.map(l => l.id) || []
        )

      const progress = lessons_count > 0
        ? Math.round((completed_count / lessons_count) * 100)
        : 0

      return { ...course, lessons_count, progress }
    })
  )

  res.json({ courses: enriched })
})

// GET /api/courses/:id — détail d'un cours avec ses leçons
router.get('/:id', requireAuth, async (req, res) => {
  const { data: course, error } = await supabase
    .from('courses')
    .select('*, created_by:users(id, full_name, avatar_url)')
    .eq('id', req.params.id)
    .single()

  if (error || !course) return res.status(404).json({ error: 'Cours non trouvé' })
  if (!course.is_published && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Cours non disponible' })
  }

  const { data: lessons } = await supabase
    .from('lessons')
    .select('*')
    .eq('course_id', req.params.id)
    .order('order_index')

  // Progression de l'utilisateur
  const { data: progress } = await supabase
    .from('course_progress')
    .select('lesson_id, completed, completed_at')
    .eq('user_id', req.user.id)
    .in('lesson_id', lessons?.map(l => l.id) || [])

  const progressMap = {}
  progress?.forEach(p => { progressMap[p.lesson_id] = p })

  const lessonsWithProgress = lessons?.map(l => ({
    ...l,
    completed: progressMap[l.id]?.completed || false,
    completed_at: progressMap[l.id]?.completed_at || null
  }))

  res.json({ course, lessons: lessonsWithProgress })
})

// POST /api/courses/:courseId/lessons/:lessonId/complete — marquer une leçon terminée
router.post('/:courseId/lessons/:lessonId/complete', requireAuth, async (req, res) => {
  const { lessonId } = req.params

  await supabase
    .from('course_progress')
    .upsert({
      user_id: req.user.id,
      lesson_id: lessonId,
      completed: true,
      completed_at: new Date().toISOString()
    })

  res.json({ message: 'Leçon marquée comme terminée' })
})

// POST /api/courses — créer un cours (admin/mentor)
router.post('/', requireAuth, async (req, res) => {
  if (!['admin', 'mentor'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Réservé aux mentors et admins' })
  }

  const { title, description, thumbnail_url, category, level } = req.body
  if (!title) return res.status(400).json({ error: 'Titre requis' })

  const { data, error } = await supabase
    .from('courses')
    .insert({ title, description, thumbnail_url, category, level, created_by: req.user.id, is_published: false })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ course: data })
})

// PUT /api/courses/:id/publish — publier un cours (admin)
router.put('/:id/publish', requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('courses')
    .update({ is_published: true })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ course: data })
})

export default router
