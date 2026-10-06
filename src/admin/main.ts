// The admin address's page (adminshell.html): a Vue app of its own with nothing of the game in it - no scene, no sound, no companion, no
// engine. It asks the server who the browser is (the account routes), shows the sign-in screen, the "staff only" page or the admin screens.
import { createApp } from 'vue'
import AdminHost from './AdminHost.vue'

createApp(AdminHost).mount('#app')
