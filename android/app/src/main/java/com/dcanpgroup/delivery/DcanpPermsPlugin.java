package com.dcanpgroup.delivery;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Permisos que necesita el delivery para seguir en el mapa con la pantalla apagada:
 * ubicación, notificaciones (aviso fijo) y batería sin restricciones.
 */
@CapacitorPlugin(name = "DcanpPerms")
public class DcanpPermsPlugin extends Plugin {

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean notificationsOn() {
        boolean enabled = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        if (Build.VERSION.SDK_INT >= 33) enabled = enabled && granted(Manifest.permission.POST_NOTIFICATIONS);
        return enabled;
    }

    private boolean batteryFree() {
        if (Build.VERSION.SDK_INT < 23) return true;
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    private void start(Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    private void openDetails() {
        start(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName())));
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("location", granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION));
        r.put("precise", granted(Manifest.permission.ACCESS_FINE_LOCATION));
        r.put("notifications", notificationsOn());
        r.put("battery", batteryFree());
        r.put("manufacturer", Build.MANUFACTURER);
        r.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(r);
    }

    @PluginMethod
    public void requestLocation(PluginCall call) {
        if (granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            call.resolve();
            return;
        }
        // Si ya lo rechazó dos veces Android no vuelve a preguntar: se abre la configuración.
        if (!ActivityCompat.shouldShowRequestPermissionRationale(getActivity(), Manifest.permission.ACCESS_FINE_LOCATION)
                && getContext().getSharedPreferences("dcanp", Context.MODE_PRIVATE).getBoolean("askedLocation", false)) {
            openDetails();
        } else {
            getContext().getSharedPreferences("dcanp", Context.MODE_PRIVATE).edit().putBoolean("askedLocation", true).apply();
            ActivityCompat.requestPermissions(getActivity(),
                    new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 7101);
        }
        call.resolve();
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)
                && !getContext().getSharedPreferences("dcanp", Context.MODE_PRIVATE).getBoolean("askedNotif", false)) {
            getContext().getSharedPreferences("dcanp", Context.MODE_PRIVATE).edit().putBoolean("askedNotif", true).apply();
            ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7102);
        } else if (!notificationsOn()) {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            try {
                start(i);
            } catch (Exception e) {
                openDetails();
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void requestBattery(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 23 && !batteryFree()) {
            try {
                start(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName())));
            } catch (Exception e) {
                try {
                    start(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                } catch (Exception e2) {
                    openDetails();
                }
            }
        }
        call.resolve();
    }

    /** Xiaomi / Huawei / Oppo / Vivo: «Inicio automático» para que el sistema no cierre la app. */
    @PluginMethod
    public void openAutostart(PluginCall call) {
        String[][] targets = {
                {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
                {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
                {"com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"},
                {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
                {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
                {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
                {"com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"},
        };
        for (String[] t : targets) {
            try {
                Intent i = new Intent();
                i.setComponent(new ComponentName(t[0], t[1]));
                start(i);
                call.resolve();
                return;
            } catch (Exception ignored) {
                // Probar el siguiente fabricante.
            }
        }
        openDetails();
        call.resolve();
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        openDetails();
        call.resolve();
    }
}
