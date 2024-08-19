<script setup lang="ts">
import { useSnackStore } from '@renderer/store/snack'
import { ref, watch } from 'vue'

const snackstore = useSnackStore()
const sudoPassword = ref('')
const showDialog = ref(false)
const showSudoPassword = ref(false)
const passwordSet = ref(false)
const checkingPassword = ref(false)
const resolve = ref()
const reject = ref()

async function setSudoPassword() {
  try {
    checkingPassword.value = true
    await window.api.setSudoPassword(sudoPassword.value)
    passwordSet.value = true
    showDialog.value = false
  } catch (error) {
    snackstore.setText('errors.invalid_sudo_password')
    snackstore.setColor('error')
    snackstore.setVisible(true)
    
    return // do nothing
  } finally {
    checkingPassword.value = false
  }

  return resolve.value()
}

async function openDialog() {
  const platform = await window.api.getPlatform()
  if (platform === 'win32') return true

  const isSudoPasswordSet = await window.api.isSudoPasswordSet()
  if (isSudoPasswordSet) {
    passwordSet.value = true
    return true
  }

  passwordSet.value = false
  showDialog.value = true

  return new Promise((res, rej) => {
    resolve.value = res
    reject.value = rej
  })
}

function closeDialog() {
  showDialog.value = false
}

defineExpose({
  openDialog,
  closeDialog
})

watch(showDialog, (newVal) => {
  if (newVal === false && !passwordSet.value) {
    reject.value(new Error('sudoPasswordNotSet'))
  }
})
</script>
<template>
  <v-dialog v-model="showDialog" max-width="500px">
    <v-card min-height="180px">
      <v-toolbar color="primary" class="d-flex justify-left">
        <v-card-text class="headline white--text">
          {{ $t('authentication_required') }}
        </v-card-text>
      </v-toolbar>

      <v-card-text class="">
        <v-container pt-4>
          <div>
            {{ $t('authentication_explanation') }}
          </div>

          <!-- <div>
            To allow for (raw) access to any SD cards and USB drives connected to
            this machine authentication as (admin)user is required.
          </div> -->

          <!-- <div class="d-flex justify-center" id="auth-footnote">
            (note that the password is only used to temporarily acquire root
            permissions and is neither stored nor made permanently accessible
            in any way!)
          </div> -->
        </v-container>

        <v-container py-2>
          <v-text-field v-model="sudoPassword" autofocus :append-icon="showSudoPassword ? 'mdi-eye' : 'mdi-eye-off'"
            :type="showSudoPassword ? 'text' : 'password'" name="input-sudoPasswd" variant="outlined"
            :label="$t('admin_password')" :disabled="checkingPassword"
            @click:append="showSudoPassword = !showSudoPassword" v-on:keyup.enter="setSudoPassword"></v-text-field>
        </v-container>

        <div class="d-flex justify-center">
          <v-btn small color="secondary" rounded :loading="checkingPassword" @click="setSudoPassword">
            <v-icon left> mdi-exit-to-app </v-icon>
            {{ $t('submit') }}
          </v-btn>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
