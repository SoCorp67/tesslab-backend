import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '../config/supabase.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Génère des suggestions de projets pour un membre via Claude
export async function generateMatches(userId) {
  // 1. Récupérer le profil du membre
  const { data: user } = await supabase
    .from('users')
    .select('full_name, interests, skills, program, bio')
    .eq('id', userId)
    .single()

  if (!user) throw new Error('Membre non trouvé')

  // 2. Récupérer les projets ouverts
  const { data: projects } = await supabase
    .from('projects')
    .select('id, title, description, skills_needed, category')
    .eq('is_open', true)
    .eq('status', 'active')
    .limit(30)

  if (!projects || projects.length === 0) {
    return []
  }

  // 3. Demander à Claude d'analyser les correspondances
  const prompt = `Tu es un assistant de matching pour TESSLAB, une association d'innovation sociale à Strasbourg.

Profil du membre :
- Nom : ${user.full_name}
- Programme : ${user.program || 'non précisé'}
- Intérêts : ${user.interests?.join(', ') || 'non précisés'}
- Compétences : ${user.skills?.join(', ') || 'non précisées'}
- Bio : ${user.bio || 'non précisée'}

Projets disponibles :
${projects.map((p, i) => `${i + 1}. [${p.id}] "${p.title}" — ${p.description || ''} — Compétences recherchées: ${p.skills_needed?.join(', ') || 'toutes'} — Catégorie: ${p.category || 'général'}`).join('\n')}

Retourne UNIQUEMENT un JSON valide (sans markdown) avec les 5 meilleurs projets pour ce membre :
[
  {
    "project_id": "uuid-du-projet",
    "score": 0.95,
    "reason": "Courte explication en 1 phrase pourquoi ce projet correspond à ce membre"
  }
]
Les scores vont de 0.0 à 1.0. Sélectionne uniquement des projets réellement pertinents (score > 0.5).`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }]
  })

  let matches = []
  try {
    const text = response.content[0].text.trim()
    matches = JSON.parse(text)
  } catch {
    console.error('Erreur parsing réponse Claude:', response.content[0].text)
    return []
  }

  // 4. Supprimer les anciens matchs et sauvegarder les nouveaux
  await supabase.from('ai_matches').delete().eq('user_id', userId)

  const toInsert = matches
    .filter(m => m.score > 0.5 && m.project_id)
    .map(m => ({
      user_id: userId,
      project_id: m.project_id,
      score: Math.min(1, Math.max(0, m.score)),
      reason: m.reason,
      seen: false
    }))

  if (toInsert.length > 0) {
    await supabase.from('ai_matches').insert(toInsert)
  }

  return toInsert
}

// Récupérer les matchs d'un membre
export async function getUserMatches(userId) {
  const { data, error } = await supabase
    .from('ai_matches')
    .select(`
      *,
      project:projects(id, title, description, skills_needed, category, owner:users(full_name, avatar_url))
    `)
    .eq('user_id', userId)
    .order('score', { ascending: false })

  if (error) throw error
  return data || []
}
