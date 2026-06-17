# TESSLAB Backend API

Backend Node.js + Express pour la plateforme TESSLAB — réseau social interne pour les adhérents de l'association.

## Stack technique

- **Runtime** : Node.js (ESM modules)
- **Framework** : Express 4
- **Base de données** : Supabase (PostgreSQL)
- **Auth** : Supabase Auth (JWT)
- **IA** : Claude API (matching projets)
- **Sécurité** : Helmet, CORS, Rate limiting, RLS Supabase

## Installation

```bash
# 1. Cloner et installer
npm install

# 2. Configurer les variables d'environnement
cp .env.example .env
# Remplir .env avec tes clés Supabase et Anthropic

# 3. Lancer la base de données
# Coller le fichier tesslab_schema.sql dans Supabase SQL Editor

# 4. Démarrer en développement
npm run dev

# 5. Production
npm start
```

## Variables d'environnement

| Variable | Description |
|---|---|
| `SUPABASE_URL` | URL de ton projet Supabase |
| `SUPABASE_ANON_KEY` | Clé publique Supabase |
| `SUPABASE_SERVICE_KEY` | Clé service Supabase (admin) |
| `ANTHROPIC_API_KEY` | Clé API Claude (matching IA) |
| `PORT` | Port du serveur (défaut: 3000) |
| `FRONTEND_URL` | URL du frontend pour CORS |

## Routes disponibles

### Auth
| Méthode | Route | Description |
|---|---|---|
| POST | `/api/auth/register` | Inscription (admin) |
| POST | `/api/auth/login` | Connexion |
| POST | `/api/auth/logout` | Déconnexion |
| GET | `/api/auth/me` | Profil connecté |

### Membres
| Méthode | Route | Description |
|---|---|---|
| GET | `/api/users` | Liste des membres |
| GET | `/api/users/:id` | Profil d'un membre |
| PUT | `/api/users/me` | Modifier son profil |
| PUT | `/api/users/:id/role` | Changer rôle (admin) |

### Fil d'actualité
| Méthode | Route | Description |
|---|---|---|
| GET | `/api/posts` | Fil global ou par groupe |
| POST | `/api/posts` | Créer un post |
| GET | `/api/posts/:id` | Post + commentaires |
| PUT | `/api/posts/:id` | Modifier son post |
| DELETE | `/api/posts/:id` | Supprimer son post |
| POST | `/api/posts/:id/like` | Liker / unliker |
| POST | `/api/posts/:id/comments` | Commenter |

### Projets
| Méthode | Route | Description |
|---|---|---|
| GET | `/api/projects` | Liste des projets |
| POST | `/api/projects` | Créer un projet |
| GET | `/api/projects/:id` | Détail projet |
| PUT | `/api/projects/:id` | Modifier projet |
| DELETE | `/api/projects/:id` | Supprimer projet |
| POST | `/api/projects/:id/join` | Rejoindre un projet |

### Matching IA
| Méthode | Route | Description |
|---|---|---|
| GET | `/api/matches` | Mes suggestions IA |
| POST | `/api/matches/generate` | Regénérer les suggestions |
| PUT | `/api/matches/:id/seen` | Marquer comme vu |

### Messagerie
| Méthode | Route | Description |
|---|---|---|
| GET | `/api/messages/conversations` | Mes conversations |
| POST | `/api/messages/conversations` | Démarrer une conversation |
| GET | `/api/messages/conversations/:id` | Messages d'une conversation |
| POST | `/api/messages/conversations/:id` | Envoyer un message |

### Cours
| Méthode | Route | Description |
|---|---|---|
| GET | `/api/courses` | Liste des cours |
| GET | `/api/courses/:id` | Cours + leçons + progression |
| POST | `/api/courses` | Créer un cours (mentor/admin) |
| PUT | `/api/courses/:id/publish` | Publier un cours (admin) |
| POST | `/api/courses/:courseId/lessons/:lessonId/complete` | Marquer leçon terminée |

## Authentification

Toutes les routes (sauf `/health`) requièrent un token Bearer :

```
Authorization: Bearer <access_token>
```

Le token est obtenu via `POST /api/auth/login`.

## Déploiement

### Railway (recommandé)
```bash
# Installer Railway CLI
npm install -g @railway/cli
railway login
railway new
railway up
# Ajouter les variables d'environnement dans le dashboard Railway
```

### Render
- Connecter le repo GitHub
- Build command: `npm install`
- Start command: `npm start`
- Ajouter les variables d'environnement

## Structure du projet

```
tesslab-backend/
├── src/
│   ├── config/
│   │   └── supabase.js       # Client Supabase
│   ├── middleware/
│   │   └── auth.js           # Auth JWT + rôles
│   ├── routes/
│   │   ├── auth.js           # Inscription / connexion
│   │   ├── users.js          # Profils membres
│   │   ├── posts.js          # Fil d'actualité
│   │   ├── projects.js       # Fiches projets
│   │   ├── matches.js        # Matching IA
│   │   ├── messages.js       # Messagerie privée
│   │   └── courses.js        # Cours en ligne
│   ├── services/
│   │   └── matching.js       # Logique Claude API
│   └── index.js              # Point d'entrée
├── .env.example
├── package.json
└── README.md
```
