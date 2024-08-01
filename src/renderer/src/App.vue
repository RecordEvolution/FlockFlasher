<script setup lang="ts">
import { ref, watch } from 'vue'

import flockFlasherLogo from './assets/icon.png'

import Settings from './components/Settings.vue'
import Drives from './components/Drives.vue'
import Devices from './components/Devices.vue'
import SudoDialog from './components/SudoDialog.vue'
import Snackbar from './components/Snackbar.vue'
import UpdateBanner from './components/UpdateBanner.vue'

const sudoDialog = ref()
const drivesDrawer = ref(false)
const settingsDrawer = ref(false)

function toggleDrivesDrawer() {
  drivesDrawer.value = !drivesDrawer.value
}

function toggleSettingsDrawer() {
  settingsDrawer.value = !settingsDrawer.value
}

watch(sudoDialog, (newVal) => {
  window.sudoDialog = newVal
})
</script>

<template>
  <v-app>
    <!-- -------------------- Drives -------------------- -->

    <v-navigation-drawer v-model="drivesDrawer" temporary width="380">
      <Drives />
    </v-navigation-drawer>

    <!-- -------------------- Settings -------------------- -->

    <v-navigation-drawer v-model="settingsDrawer" temporary location="right" width="380">
      <Settings />
    </v-navigation-drawer>

    <!-- -------------------- App bar -------------------- -->

    <v-app-bar app color="primary">
      <v-btn min-width="164px" @click.stop="toggleDrivesDrawer" variant="outlined" color="accent">
        {{ $t('drives') }}
      </v-btn>

      <v-spacer></v-spacer>

      <div>
        <v-toolbar-title>
          <div style="display: flex; justify-content: center; align-items: center;">
            <img :src="flockFlasherLogo" alt="Reflasher-logo" width="30" height="30" style="margin-right: 10px;" />
            <p>FlockFlasher</p>
          </div>
        </v-toolbar-title>
      </div>

      <v-spacer></v-spacer>

      <v-btn min-width="164px" @click.stop="toggleSettingsDrawer" variant="outlined" color="accent">
        {{ $t('settings') }}
      </v-btn>
    </v-app-bar>

    <!-- -------------------- Devices -------------------- -->

    <v-main>
      <v-container fluid ml-0 mr-0 mt-0 mb-12 pl-12 pr-12>
        <Devices />
      </v-container>
    </v-main>

    <v-main v-if="false">
      <v-container fluid ml-0 mr-0 mt-0 mb-12 pl-12 pr-12></v-container>
    </v-main>

    <!-- -------------------- Footer -------------------- -->

    <v-footer fixed class="pa-0" color="primary">
      <v-container fluid fill-width class="ma-0 pa-0">
        <div class="d-flex justify-center ma-0 mp-0">
          <v-btn href="https://studio.ironflock.com/" target="_blank" variant="text" color="primary"
            id="reswarm-link-button" rounded fixed>
            IronFlock Platform
          </v-btn>
        </div>
      </v-container>
    </v-footer>

    <v-banner id="updaterBar" v-show="false" color="info" rounded elevation="10" style="z-index: 99" height="120"
      width="370">
      <div id="updaterText"></div>
      <div>
        <v-btn class="ma-2" min-width="120px">
          {{ $t('dismiss') }}
        </v-btn>
        <v-btn class="ma-2" min-width="120px">
          {{ $t('download') }}
        </v-btn>
      </div>
      <div>
        <v-progress-linear color="secondary" rounded height="40"> </v-progress-linear>
      </div>
      <div>
        <v-btn class="ma-2" min-width="120px">
          {{ $t('not_now') }}
        </v-btn>
        <v-btn class="ma-2" min-width="120px" color="accent">
          {{ $t('install') }}
        </v-btn>
      </div>
    </v-banner>

    <v-dialog max-width="560px" persistent>
      <v-card min-height="260px">
        <v-toolbar color="primary">
          <v-card-text class="headline white--text">
            {{ $t('environment_variables') }}
          </v-card-text>
        </v-toolbar>

        <v-card-text>
          <div class="mt-8 mb-4" style="font-size: 16px">
            <p>{{ $t('environment_variables_not_set') }}</p>
            <p>
              <strong></strong>
            </p>
            <p>{{ $t('please_ensure_environment_variables') }}</p>
          </div>

          <div class="d-flex justify-end">
            <v-btn class="ma-2" min-width="120px" color="accent">
              {{ $t('exit_reflasher') }}
            </v-btn>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <SudoDialog ref="sudoDialog" />
    <Snackbar />
    <UpdateBanner />
  </v-app>
</template>

<style>
.v-footer {
  height: 40px !important;
  flex: none !important;
  display: block !important;
}

#reswarm-link-wrapper {
  position: fixed;
  bottom: -14px;
  right: 0px;
}

#reswarm-link-button {
  text-transform: none;
  font-family: sans-serif;
  font-size: 0.8em;
  color: white !important;
  letter-spacing: 0.1px;
  padding: 0px;
  padding-top: 0px;
}

#snacker-message {
  text-align: center;
  font-size: 15px;
}

#updaterBar {
  position: fixed;
  bottom: 54px;
  left: 14px;
  text-align: center;
}

#updaterBar div {
  border-bottom: none;
}

#updaterText {
  font-size: 18px;
  /* color: #233543; */
  padding: 8px;
}

#updateProgress {
  padding: 8px;
}
</style>
