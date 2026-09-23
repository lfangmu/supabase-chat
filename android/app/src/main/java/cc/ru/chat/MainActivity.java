package cc.ru.chat;

import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    private PermissionRequest pendingPermissionRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setupWebViewPermissions();
    }

    private void setupWebViewPermissions() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;

        // Extend BridgeWebChromeClient (not plain WebChromeClient!) so we keep
        // Capacitor's onShowFileChooser (file picker + camera option) and other
        // built-in functionality, while adding media permission handling.
        webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                String[] resources = request.getResources();
                List<String> granted = new ArrayList<>();

                for (String resource : resources) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                        granted.add(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
                    } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                        granted.add(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
                    }
                }

                if (!granted.isEmpty()) {
                    List<String> neededPerms = new ArrayList<>();
                    if (granted.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                        if (!hasPermission("android.permission.RECORD_AUDIO")) {
                            neededPerms.add("android.permission.RECORD_AUDIO");
                        }
                    }
                    if (granted.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                        if (!hasPermission("android.permission.CAMERA")) {
                            neededPerms.add("android.permission.CAMERA");
                        }
                    }

                    if (!neededPerms.isEmpty()) {
                        pendingPermissionRequest = request;
                        requestPermissions(
                            neededPerms.toArray(new String[0]),
                            1001
                        );
                    } else {
                        request.grant(granted.toArray(new String[0]));
                    }
                } else {
                    // Not a media request — delegate to parent (which denies by default)
                    super.onPermissionRequest(request);
                }
            }
        });
    }

    private boolean hasPermission(String permission) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        return checkSelfPermission(permission) == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == 1001 && pendingPermissionRequest != null) {
            List<String> granted = new ArrayList<>();
            for (int i = 0; i < permissions.length; i++) {
                if (grantResults[i] == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    if ("android.permission.RECORD_AUDIO".equals(permissions[i])) {
                        granted.add(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
                    } else if ("android.permission.CAMERA".equals(permissions[i])) {
                        granted.add(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
                    }
                }
            }

            if (!granted.isEmpty()) {
                pendingPermissionRequest.grant(granted.toArray(new String[0]));
            } else {
                pendingPermissionRequest.deny();
            }
            pendingPermissionRequest = null;
        }
    }
}
