package com.dcanpgroup.delivery;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Permisos de la app (ubicación, notificaciones, batería) para el asistente de la web.
        registerPlugin(DcanpPermsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
