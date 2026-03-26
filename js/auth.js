function showTab(tab) {
  document.getElementById('login-form').style.display = tab === 'login' ? 'block' : 'none'
  document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none'
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
  event.target.classList.add('active')
}

async function login() {
  const email = document.getElementById('login-email').value
  const password = document.getElementById('login-password').value
  const msg = document.getElementById('auth-message')

  const { error } = await window.supabase.auth.signInWithPassword({ email, password })

  if (error) {
    msg.style.color = '#f87171'
    msg.textContent = 'Erreur : ' + error.message
  } else {
    msg.style.color = '#4ade80'
    msg.textContent = 'Connecté ! Redirection...'
    setTimeout(() => window.location.href = 'dashboard.html', 1000)
  }
}

async function register() {
  const username = document.getElementById('register-username').value
  const email = document.getElementById('register-email').value
  const password = document.getElementById('register-password').value
  const msg = document.getElementById('auth-message')

  const { data, error } = await window.supabase.auth.signUp({
    email,
    password,
    options: { data: { username } }
  })

  if (error) {
    msg.style.color = '#f87171'
    msg.textContent = 'Erreur : ' + error.message
  } else {
    msg.style.color = '#4ade80'
    msg.textContent = 'Compte créé ! Vérifie ton email pour confirmer.'
  }
}window.showTab = showTab
window.login = login
window.register = register