plugins {
    id("com.android.application")
}

android {
    namespace = "fr.covoiturage.pde"
    compileSdk = 34

    defaultConfig {
        applicationId = "fr.covoiturage.pde"
        minSdk = 24
        targetSdk = 34
        // Le workflow passe le numéro de build GitHub pour que chaque APK remplace le précédent.
        versionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = "1." + versionCode
    }

    // Signature : avec la clé fournie par les secrets GitHub (ANDROID_KEYSTORE_*), l'APK garde la
    // même signature d'une version à l'autre et se met à jour sans perdre les données.
    // Sans ces secrets : signature de test (debug), différente à chaque compilation.
    val ks = file("release.jks")
    signingConfigs {
        if (ks.exists()) create("release") {
            storeFile = ks
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("ANDROID_KEY_ALIAS")
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (ks.exists()) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.core:core:1.13.1")
}
