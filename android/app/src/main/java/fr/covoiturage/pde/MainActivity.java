package fr.covoiturage.pde;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.TextUtils;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Arrays;

/**
 * L'appli affiche la version « fichier unique » de Covoiturage PDE (copiée dans
 * assets/index.html au moment de la compilation). Les données restent dans la WebView,
 * sur le téléphone. Cette activité ajoute ce qu'une page web ne sait pas faire seule :
 * appareil photo, choix de fichiers, enregistrement, ouverture et partage des PDF.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/index.html";
    private static final int REQ_CAMERA = 1;
    private static final int REQ_FILES = 2;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private Uri photoUri;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Adresse https fixe : le stockage (IndexedDB) reste le même d'une version à l'autre.
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(true);

        web.addJavascriptInterface(new Bridge(), "AndroidApp");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return loader.shouldInterceptRequest(req.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                if ("blob".equals(u.getScheme()) || "data".equals(u.getScheme())) return true;
                try {
                    if ("mailto".equals(u.getScheme())) startActivity(new Intent(Intent.ACTION_SENDTO, u));
                    else startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException e) {
                    toast("Aucune application pour ouvrir ce lien.");
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                String accept = params.getAcceptTypes() == null ? "" : TextUtils.join(",", params.getAcceptTypes());
                boolean image = accept.contains("image/");
                try {
                    if (image && params.isCaptureEnabled()) openCamera();
                    else openFiles(accept);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    toast("Impossible d'ouvrir " + (image ? "l'appareil photo." : "le sélecteur de fichiers."));
                    return false;
                }
            }
        });

        setContentView(web);
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START_URL);
    }

    // --- Appareil photo et choix de fichiers -------------------------------------------

    private void openCamera() throws Exception {
        File dir = new File(getCacheDir(), "photos");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("dossier photos");
        File f = new File(dir, "photo-" + System.currentTimeMillis() + ".jpg");
        photoUri = FileProvider.getUriForFile(this, getPackageName() + ".fichiers", f);
        Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        i.putExtra(MediaStore.EXTRA_OUTPUT, photoUri);
        i.setClipData(ClipData.newRawUri("photo", photoUri));
        i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(i, REQ_CAMERA);
    }

    private void openFiles(String accept) {
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        if (accept.contains("image/")) i.setType("image/*");
        else if (accept.contains("application/pdf")) i.setType("application/pdf");
        else i.setType("*/*"); // sauvegardes et dossiers .json : type souvent mal reconnu
        startActivityForResult(Intent.createChooser(i, "Choisir un fichier"), REQ_FILES);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            if (requestCode == REQ_CAMERA && photoUri != null) {
                result = new Uri[]{photoUri};
            } else if (requestCode == REQ_FILES && data != null) {
                if (data.getClipData() != null && data.getClipData().getItemCount() > 0) {
                    result = new Uri[]{data.getClipData().getItemAt(0).getUri()};
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    // --- Pont JavaScript : enregistrer / ouvrir / partager ----------------------------

    private class Bridge {
        @JavascriptInterface
        public String saveFile(String b64, String name, String mime) {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            String clean = cleanName(name);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, clean);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime);
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Covoiturage");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new Exception("insert");
                    try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                        if (out == null) throw new Exception("stream");
                        out.write(bytes);
                    }
                    return "Enregistré dans Téléchargements/Covoiturage : " + clean;
                } catch (Exception e) {
                    return "Enregistrement impossible : " + e.getMessage();
                }
            }
            // Android 9 et moins : on passe par le partage (Drive, Fichiers…)
            share(bytes, clean, mime, "", "", "");
            return "";
        }

        @JavascriptInterface
        public void shareFile(String b64, String name, String mime, String subject, String text, String to) {
            share(Base64.decode(b64, Base64.DEFAULT), cleanName(name), mime, subject, text, to);
        }

        @JavascriptInterface
        public void openFile(String b64, String name, String mime) {
            try {
                Uri uri = writeShared(Base64.decode(b64, Base64.DEFAULT), cleanName(name));
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, mime);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                runOnUiThread(() -> {
                    try { startActivity(i); } catch (ActivityNotFoundException e) { toast("Aucune application pour ouvrir ce fichier."); }
                });
            } catch (Exception e) {
                toast("Ouverture impossible : " + e.getMessage());
            }
        }
    }

    private void share(byte[] bytes, String name, String mime, String subject, String text, String to) {
        try {
            Uri uri = writeShared(bytes, name);
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType(mime);
            i.putExtra(Intent.EXTRA_STREAM, uri);
            i.setClipData(ClipData.newRawUri(name, uri));
            if (subject != null && !subject.isEmpty()) i.putExtra(Intent.EXTRA_SUBJECT, subject);
            if (text != null && !text.isEmpty()) i.putExtra(Intent.EXTRA_TEXT, text);
            if (to != null && !to.isEmpty()) i.putExtra(Intent.EXTRA_EMAIL, new String[]{to});
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(i, (to != null && !to.isEmpty()) ? "Envoyer par e-mail" : "Partager");
            runOnUiThread(() -> startActivity(chooser));
        } catch (Exception e) {
            toast("Partage impossible : " + e.getMessage());
        }
    }

    private Uri writeShared(byte[] bytes, String name) throws Exception {
        File dir = new File(getCacheDir(), "partage");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("dossier de partage");
        // on ne garde que les derniers fichiers partagés
        File[] old = dir.listFiles();
        if (old != null && old.length > 10) {
            Arrays.sort(old, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
            for (int k = 0; k < old.length - 10; k++) //noinspection ResultOfMethodCallIgnored
                old[k].delete();
        }
        File f = new File(dir, name);
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(bytes);
        }
        return FileProvider.getUriForFile(this, getPackageName() + ".fichiers", f);
    }

    private static String cleanName(String name) {
        String n = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|]+", "_").trim();
        return n.isEmpty() ? "fichier" : n;
    }

    private void toast(String msg) {
        runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show());
    }

    // --- Cycle de vie et bouton retour ------------------------------------------------

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        // Le bouton retour revient d'abord à l'écran précédent de l'appli.
        web.evaluateJavascript("window.appBack?appBack():false", v -> {
            if (!"true".equals(v)) MainActivity.super.onBackPressed();
        });
    }
}
