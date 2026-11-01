import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

type ChannelKey =
  | 'general'
  | 'consulta_comisiones'
  | 'comprobantes_transferencias'
  | 'reclamos_garantias'
  | 'consultas_estados'
  | 'fotos_productos';

type ChatTab = ChannelKey | 'dm';

type Contact = {
  email: string;
  name: string | null;
  role: string | null;
};

type ChatChannel = {
  id?: string;
  channel_key: ChannelKey;
  title: string;
  logo_url: string | null;
};

type Attachment = {
  url: string;
  name: string;
  type: 'image' | 'audio' | 'video' | 'file';
  mime: string;
};

type ChatMessage = {
  id: string;
  sender_email?: string | null;
  sender_role?: string | null;
  from_email?: string | null;
  from_role?: string | null;
  to_email?: string | null;
  thread_key?: string | null;
  topic_channel?: string | null;
  message_text: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_type?: string | null;
  attachment_mime?: string | null;
  channel_key?: string | null;
  created_at: string;
  read_at?: string | null;
  deleted_for?: string[] | null;
};

type Thread = {
  key: string;
  peer: string;
  peerName: string;
  lastMsg: string;
  lastTime: string;
  unread: number;
  topicChannel?: string;
};

type NotificationData = {
  from: string;
  fromEmail: string;
  message: string;
  topicChannel: string;
};

const FALLBACK_CHANNELS: ChatChannel[] = [
  { channel_key: 'general', title: 'Chat General', logo_url: null },
  { channel_key: 'consulta_comisiones', title: 'Consulta de comisiones', logo_url: null },
  {
    channel_key: 'comprobantes_transferencias',
    title: 'Comprobantes de transferencias para encomienda',
    logo_url: null,
  },
  { channel_key: 'reclamos_garantias', title: 'Reclamos y garantías', logo_url: null },
  { channel_key: 'consultas_estados', title: 'Consultas de estados', logo_url: null },
  { channel_key: 'fotos_productos', title: 'Fotos de productos', logo_url: null },
];

const EMOJIS = ['😀', '😂', '😍', '👍', '🙏', '🔥', '📦', '✅', '⚠️', '💰', '🚚', '🧾'];

// Canales públicos (todos ven, no requieren destinatario)
const PUBLIC_CHANNELS: ChatTab[] = ['general', 'fotos_productos'];

// Canales que son DM (requieren destinatario)
const DM_CHANNELS: ChatTab[] = [
  'consulta_comisiones',
  'comprobantes_transferencias',
  'reclamos_garantias',
  'consultas_estados'
];

// LISTA MANUAL DE PROVEEDORES (para vendedores)
const PROVIDERS_LIST = [
  { email: 'skylinestore06@gmail.com', name: 'PROVEEDOR SKYLINE', role: 'PROVEEDOR' },
  { email: 'importadoraaliado@gmail.com', name: 'IMPORTS ALIADEX', role: 'PROVEEDOR' },
  { email: 'nkshop@gmail.com', name: 'PROVEEDOR NKSHOP', role: 'PROVEEDOR' },
];

// Clave para guardar preferencia de notificaciones
const NOTIFICATIONS_ENABLED_KEY = 'chat_notifications_enabled';

function getAttachmentType(file: File): Attachment['type'] {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return 'file';
}

function inferAttachmentType(message: ChatMessage): Attachment['type'] {
  if (message.attachment_type === 'image') return 'image';
  if (message.attachment_type === 'audio') return 'audio';
  if (message.attachment_type === 'video') return 'video';

  const name = (message.attachment_name || message.attachment_url || '').toLowerCase();
  const mime = message.attachment_mime || '';

  if (mime.startsWith('video/')) return 'video';
  if (/\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|mpg|mpeg|3gp)$/.test(name)) return 'video';
  if (/\.(png|jpg|jpeg|webp|gif|bmp|svg)$/.test(name)) return 'image';
  if (/\.(mp3|wav|ogg|webm|m4a|aac)$/.test(name)) return 'audio';

  return 'file';
}

function formatTime(value?: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('es-PY', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateTime(value?: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleString('es-PY');
}

export default function ChatView() {
  const { profile } = useAuth();

  const myEmail = profile?.email || '';
  const myRole = profile?.role || '';
  const isApproved = Boolean(profile?.approved);

  const [tab, setTab] = useState<ChatTab>('general');
  const [channels, setChannels] = useState<ChatChannel[]>(FALLBACK_CHANNELS);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);

  const [channelMessages, setChannelMessages] = useState<ChatMessage[]>([]);
  const [selectedPeer, setSelectedPeer] = useState('');
  const [dmMessages, setDmMessages] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [channelThreads, setChannelThreads] = useState<Thread[]>([]);

  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({});
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [loadingContacts, setLoadingContacts] = useState(true);

  // ========== NOTIFICACIONES ==========
  const [notification, setNotification] = useState<NotificationData | null>(null);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
    return saved === null ? true : saved === 'true';
  });
  const [notificationPermission, setNotificationPermission] = useState(false);
  const originalTitleRef = useRef(document.title);

  const msgRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const typingTimeoutRef = useRef<number | null>(null);
  const typingChannelRef = useRef<any>(null);
  const notificationTimeoutRef = useRef<number | null>(null);

  const isPublicChannel = PUBLIC_CHANNELS.includes(tab as ChannelKey);
  const isDMChannel = DM_CHANNELS.includes(tab as ChannelKey);
  const isAdminOrDespachante = myRole === 'ADMIN' || myRole === 'DESPACHANTE';
  const isProvider = myRole === 'PROVEEDOR';
  const isSeller = myRole === 'VENDEDOR';
  
  // Definir canEditChannelLogo
  const canEditChannelLogo = isApproved && (myRole === 'ADMIN' || myRole === 'PROVEEDOR');

  const activeChannel = useMemo(() => {
    if (tab === 'dm') return null;
    return channels.find((channel) => channel.channel_key === tab) || FALLBACK_CHANNELS[0];
  }, [channels, tab]);

  const contactMap = useMemo(() => {
    const map: Record<string, { name: string; role: string }> = {};

    contacts.forEach((contact) => {
      map[contact.email.toLowerCase()] = {
        name: contact.name || contact.email.split('@')[0],
        role: contact.role || '',
      };
    });

    // Agregar proveedores manuales al mapa
    PROVIDERS_LIST.forEach(provider => {
      map[provider.email.toLowerCase()] = {
        name: provider.name,
        role: provider.role,
      };
    });

    return map;
  }, [contacts]);

  // Contactos disponibles para el selector
  const availableContacts = useMemo(() => {
    if (isSeller) {
      // Vendedor: mostrar los proveedores de la lista manual
      const providers = PROVIDERS_LIST.map(p => ({
        email: p.email,
        name: p.name,
        role: p.role,
      }));
      return providers;
    }
    
    if (isAdminOrDespachante || isProvider) {
      // Admin, Despachante o Proveedor: todos los contactos
      return contacts.filter(c => c.email !== myEmail);
    }
    
    return [];
  }, [contacts, myEmail, isSeller, isAdminOrDespachante, isProvider]);

  const canViewChat = (peerEmail: string): boolean => {
    if (!myEmail || !peerEmail) return false;
    if (isAdminOrDespachante) return true;
    if (isProvider) return true;
    if (isSeller) {
      const isProviderPeer = PROVIDERS_LIST.some(p => p.email.toLowerCase() === peerEmail.toLowerCase());
      return isProviderPeer;
    }
    return true;
  };

  const canSendToPeer = (peerEmail: string): boolean => {
    if (!myEmail || !peerEmail) return false;
    if (isAdminOrDespachante) return true;
    if (isProvider) return true;
    if (isSeller) {
      const isProviderPeer = PROVIDERS_LIST.some(p => p.email.toLowerCase() === peerEmail.toLowerCase());
      return isProviderPeer;
    }
    return true;
  };

  const filterDeletedMessages = (messages: ChatMessage[]): ChatMessage[] => {
    if (!myEmail) return messages;
    return messages.filter(msg => !msg.deleted_for?.includes(myEmail));
  };

  const messages = useMemo(() => {
    const rawMessages = tab === 'dm' ? dmMessages : channelMessages;
    return filterDeletedMessages(rawMessages);
  }, [tab, dmMessages, channelMessages, myEmail]);

  const threadKey = (a: string, b: string) => {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? `${x}|${y}` : `${y}|${x}`;
  };

  const scrollBottom = () => {
    setTimeout(() => {
      if (msgRef.current) {
        msgRef.current.scrollTop = msgRef.current.scrollHeight;
      }
    }, 200);
  };

  const getLastSeenKey = (channelKey: string) => `chat_last_seen_${myEmail}_${channelKey}`;
  const getLastSeenThreadKey = (threadKeyValue: string, topicChannel: string) => 
    `chat_last_seen_thread_${myEmail}_${topicChannel}_${threadKeyValue}`;

  const markChannelSeenLocal = (channelKey: string) => {
    if (!myEmail) return;
    localStorage.setItem(getLastSeenKey(channelKey), new Date().toISOString());
    setUnreadByChannel((prev) => ({ ...prev, [channelKey]: 0 }));
  };

  const markThreadSeenLocal = (threadKeyValue: string, topicChannel: string) => {
    if (!myEmail) return;
    localStorage.setItem(getLastSeenThreadKey(threadKeyValue, topicChannel), new Date().toISOString());
  };

  // ========== FUNCIONES DE NOTIFICACIÓN ==========
  const showNotification = (from: string, fromEmail: string, messageText: string, topicChannel: string) => {
    if (!notificationsEnabled) return;
    
    const isCurrentChat = selectedPeer === fromEmail && tab === topicChannel;
    const isPageVisibleAndChatOpen = isPageVisible && isCurrentChat;
    
    if (isPageVisibleAndChatOpen) return;
    
    const senderName = contactMap[fromEmail.toLowerCase()]?.name || from;
    const messagePreview = messageText || (messageText === '' ? '📎 Archivo adjunto' : 'Mensaje');
    
    // Cambiar título de la pestaña
    document.title = `📩 Nuevo mensaje de ${senderName}`;
    if (notificationTimeoutRef.current) clearTimeout(notificationTimeoutRef.current);
    notificationTimeoutRef.current = window.setTimeout(() => {
      document.title = originalTitleRef.current;
    }, 5000);
    
    // Mostrar burbuja flotante
    setNotification({
      from: senderName,
      fromEmail: fromEmail,
      message: messagePreview.length > 60 ? messagePreview.substring(0, 60) + '...' : messagePreview,
      topicChannel: topicChannel,
    });
    
    // Mostrar notificación del sistema
    if (notificationPermission && !isPageVisible) {
      new Notification(`💬 Nuevo mensaje de ${senderName}`, {
        body: messagePreview,
        icon: '/favicon.ico',
        silent: false,
      });
    }
    
    // Auto-ocultar burbuja después de 6 segundos
    setTimeout(() => {
      setNotification(null);
    }, 6000);
  };

  const handleNotificationClick = (notif: NotificationData) => {
    // Cambiar a la conversación correcta
    setTab(notif.topicChannel === 'dm' ? 'dm' : notif.topicChannel as ChatTab);
    setSelectedPeer(notif.fromEmail);
    loadDmMessages(notif.fromEmail, notif.topicChannel);
    setNotification(null);
  };

  const toggleNotifications = () => {
    const newValue = !notificationsEnabled;
    setNotificationsEnabled(newValue);
    localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, String(newValue));
    toast.info(newValue ? '🔔 Notificaciones activadas' : '🔕 Notificaciones desactivadas');
  };

  // ========== FIN NOTIFICACIONES ==========

  const loadChannels = async () => {
    const { data, error } = await (supabase as any)
      .from('chat_channels')
      .select('*')
      .order('created_at', { ascending: true });

    if (error || !data?.length) {
      setChannels(FALLBACK_CHANNELS);
      return;
    }

    setChannels(
      data.map((item: any) => ({
        id: item.id,
        channel_key: item.channel_key as ChannelKey,
        title: item.title,
        logo_url: item.logo_url || null,
      })),
    );
  };

  const loadContacts = async () => {
    setLoadingContacts(true);
    
    try {
      const [profRes, rolesRes] = await Promise.all([
        supabase.from('profiles').select('email, name, user_id').eq('approved', true),
        supabase.from('user_roles').select('user_id, role').eq('approved', true),
      ]);

      const roleMap = new Map<string, string>();

      (rolesRes.data || []).forEach((role: any) => {
        roleMap.set(role.user_id, role.role);
      });

      const contactList = (profRes.data || []).map((person: any) => ({
        email: person.email,
        name: person.name,
        role: roleMap.get(person.user_id) || null,
      }));

      setContacts(contactList);
    } catch (err) {
      console.error('Error cargando contactos:', err);
    } finally {
      setLoadingContacts(false);
    }
  };

  const loadChannelMessages = async (channelKey: ChannelKey) => {
    if (PUBLIC_CHANNELS.includes(channelKey)) {
      const { data, error } = await (supabase as any)
        .from('chat_messages')
        .select('*')
        .eq('channel_key', channelKey)
        .order('created_at', { ascending: true })
        .limit(250);

      if (error) {
        console.error(error);
        toast.error('No se pudieron cargar los mensajes del canal');
        return;
      }

      setChannelMessages(data || []);
      scrollBottom();
    } else {
      setChannelMessages([]);
    }
  };

  const loadChannelThreads = async (channelTab: ChatTab) => {
    if (!myEmail) return;
    if (!DM_CHANNELS.includes(channelTab)) return;

    let query = (supabase as any)
      .from('chat_dm_messages')
      .select('*')
      .eq('topic_channel', channelTab);

    if (!isAdminOrDespachante && !isProvider) {
      query = query.or(`from_email.eq.${myEmail},to_email.eq.${myEmail}`);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error(error);
      return;
    }

    const notDeletedForMe = data?.filter((msg: ChatMessage) => !msg.deleted_for?.includes(myEmail)) || [];
    
    const threadsMap = new Map<string, Thread>();

    notDeletedForMe.forEach((message: ChatMessage) => {
      let peer: string;
      let key: string;
      
      if (isAdminOrDespachante) {
        const email1 = message.from_email?.toLowerCase() || '';
        const email2 = message.to_email?.toLowerCase() || '';
        key = email1 < email2 ? `${email1}|${email2}` : `${email2}|${email1}`;
        peer = key;
      } else {
        peer = message.from_email?.toLowerCase() === myEmail.toLowerCase()
          ? message.to_email || ''
          : message.from_email || '';
        key = threadKey(myEmail, peer);
      }

      if (!peer) return;
      
      if (!canViewChat(peer)) return;

      if (!threadsMap.has(key)) {
        let peerName: string;
        let unread = 0;
        
        if (isAdminOrDespachante) {
          const participant1 = contactMap[message.from_email?.toLowerCase() || '']?.name || message.from_email;
          const participant2 = contactMap[message.to_email?.toLowerCase() || '']?.name || message.to_email;
          peerName = `${participant1} ↔ ${participant2}`;
          
          unread = notDeletedForMe.filter(
            (item: ChatMessage) => {
              const itemKey = item.from_email?.toLowerCase() < item.to_email?.toLowerCase()
                ? `${item.from_email?.toLowerCase()}|${item.to_email?.toLowerCase()}`
                : `${item.to_email?.toLowerCase()}|${item.from_email?.toLowerCase()}`;
              return itemKey === key && !item.read_at;
            }
          ).length;
        } else {
          peerName = contactMap[peer.toLowerCase()]?.name || peer.split('@')[0];
          
          unread = notDeletedForMe.filter(
            (item: ChatMessage) =>
              item.thread_key === key &&
              item.to_email?.toLowerCase() === myEmail.toLowerCase() &&
              !item.read_at
          ).length;
        }

        threadsMap.set(key, {
          key,
          peer,
          peerName,
          lastMsg: message.message_text || message.attachment_name || 'Adjunto',
          lastTime: message.created_at,
          unread,
          topicChannel: channelTab,
        });
      }
    });

    setChannelThreads(Array.from(threadsMap.values()));
  };

  const loadUnreadCounts = async () => {
    if (!myEmail) return;

    const nextChannel: Record<string, number> = {};

    await Promise.all(
      channels.filter(ch => PUBLIC_CHANNELS.includes(ch.channel_key)).map(async (channel) => {
        const lastSeen = localStorage.getItem(getLastSeenKey(channel.channel_key));

        let query = (supabase as any)
          .from('chat_messages')
          .select('id, sender_email, created_at, deleted_for')
          .eq('channel_key', channel.channel_key)
          .neq('sender_email', myEmail);

        if (lastSeen) {
          query = query.gt('created_at', lastSeen);
        }

        const { data, error } = await query;

        if (!error) {
          const notDeletedForMe = data?.filter(msg => !msg.deleted_for?.includes(myEmail)) || [];
          nextChannel[channel.channel_key] = notDeletedForMe.length || 0;
        }
      }),
    );

    setUnreadByChannel(nextChannel);
  };

  const loadDMThreads = async () => {
    if (!myEmail) return;

    let query = (supabase as any)
      .from('chat_dm_messages')
      .select('*')
      .eq('topic_channel', 'dm');

    if (!isAdminOrDespachante && !isProvider) {
      query = query.or(`from_email.eq.${myEmail},to_email.eq.${myEmail}`);
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(500);

    if (error) {
      console.error(error);
      return;
    }

    const notDeletedForMe = data?.filter(msg => !msg.deleted_for?.includes(myEmail)) || [];

    const map = new Map<string, Thread>();

    notDeletedForMe.forEach((message: ChatMessage) => {
      let peer: string;
      let key: string;
      
      if (isAdminOrDespachante) {
        const email1 = message.from_email?.toLowerCase() || '';
        const email2 = message.to_email?.toLowerCase() || '';
        key = email1 < email2 ? `${email1}|${email2}` : `${email2}|${email1}`;
        peer = key;
      } else {
        peer = message.from_email?.toLowerCase() === myEmail.toLowerCase()
          ? message.to_email || ''
          : message.from_email || '';
        key = threadKey(myEmail, peer);
      }

      if (!peer) return;

      if (!map.has(key)) {
        let peerName: string;
        let unread = 0;
        
        if (isAdminOrDespachante) {
          const participant1 = contactMap[message.from_email?.toLowerCase() || '']?.name || message.from_email;
          const participant2 = contactMap[message.to_email?.toLowerCase() || '']?.name || message.to_email;
          peerName = `${participant1} ↔ ${participant2}`;
          
          unread = notDeletedForMe.filter(
            (item: ChatMessage) => {
              const itemKey = item.from_email?.toLowerCase() < item.to_email?.toLowerCase()
                ? `${item.from_email?.toLowerCase()}|${item.to_email?.toLowerCase()}`
                : `${item.to_email?.toLowerCase()}|${item.from_email?.toLowerCase()}`;
              return itemKey === key && !item.read_at;
            }
          ).length;
        } else {
          if (!canViewChat(peer)) return;
          peerName = contactMap[peer.toLowerCase()]?.name || peer.split('@')[0];
          
          unread = notDeletedForMe.filter(
            (item: ChatMessage) =>
              item.thread_key === key &&
              item.to_email?.toLowerCase() === myEmail.toLowerCase() &&
              !item.read_at
          ).length;
        }

        map.set(key, {
          key,
          peer,
          peerName,
          lastMsg: message.message_text || message.attachment_name || 'Adjunto',
          lastTime: message.created_at,
          unread,
          topicChannel: 'dm',
        });
      }
    });

    setThreads(Array.from(map.values()));
  };

  const loadDmMessages = async (peer: string, topicChannel?: string) => {
    if (!myEmail || !peer) return;

    if (!canViewChat(peer)) {
      toast.error('No tenés permiso para ver esta conversación');
      setSelectedPeer('');
      return;
    }

    const channel = topicChannel || (isDMChannel ? tab : 'dm');
    
    let query = (supabase as any)
      .from('chat_dm_messages')
      .select('*')
      .eq('topic_channel', channel);

    if (isAdminOrDespachante) {
      if (peer.includes('|')) {
        const [email1, email2] = peer.split('|');
        query = query.or(`and(from_email.eq.${email1},to_email.eq.${email2}),and(from_email.eq.${email2},to_email.eq.${email1})`);
      } else {
        query = query.or(`from_email.eq.${peer},to_email.eq.${peer}`);
      }
    } else {
      const key = threadKey(myEmail, peer);
      query = query.eq('thread_key', key);
    }

    const { data, error } = await query
      .order('created_at', { ascending: true })
      .limit(250);

    if (error) {
      console.error(error);
      toast.error('No se pudieron cargar los mensajes directos');
      return;
    }

    setDmMessages(data || []);
    scrollBottom();

    // Marcar como leídos
    const unreadMessages = data?.filter(
      (msg: ChatMessage) => msg.to_email === myEmail && !msg.read_at
    );

    if (unreadMessages && unreadMessages.length > 0) {
      await (supabase as any)
        .from('chat_dm_messages')
        .update({ read_at: new Date().toISOString() })
        .in('id', unreadMessages.map((m: ChatMessage) => m.id));
    }

    if (channel !== 'dm') {
      if (!isAdminOrDespachante && !isProvider) {
        const key = threadKey(myEmail, peer);
        markThreadSeenLocal(key, channel);
      }
      await loadChannelThreads(tab);
    } else {
      if (!isAdminOrDespachante && !isProvider) {
        const key = threadKey(myEmail, peer);
        markThreadSeenLocal(key, 'dm');
      }
      await loadDMThreads();
    }
  };

  const selectPeer = (peer: string, topicChannel?: string) => {
    if (!peer) {
      setSelectedPeer('');
      return;
    }
    
    if (!canSendToPeer(peer)) {
      toast.error('No tenés permiso para escribirle a este destinatario');
      return;
    }
    
    setSelectedPeer(peer);
    loadDmMessages(peer, topicChannel);
  };

  const handleFileUpload = async (file: File): Promise<Attachment | null> => {
    setUploading(true);

    try {
      const safeName = file.name.replace(/[^\w.\-]+/g, '_');
      const path = `${myEmail || 'anon'}/${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}_${safeName}`;

      const { error } = await supabase.storage.from('chat-attachments').upload(path, file);

      if (error) {
        console.error(error);
        toast.error('Error subiendo archivo');
        return null;
      }

      const { data: urlData } = supabase.storage.from('chat-attachments').getPublicUrl(path);

      return {
        url: urlData.publicUrl,
        name: file.name,
        type: getAttachmentType(file),
        mime: file.type || 'application/octet-stream',
      };
    } catch (error) {
      console.error(error);
      toast.error('Error subiendo archivo');
      return null;
    } finally {
      setUploading(false);
    }
  };

  const deleteMessage = async (messageId: string) => {
    if (!myEmail) return;

    const table = 'chat_dm_messages';
    
    const { data: currentMessage } = await (supabase as any)
      .from(table)
      .select('deleted_for')
      .eq('id', messageId)
      .single();

    const currentDeletedFor = currentMessage?.deleted_for || [];
    
    if (currentDeletedFor.includes(myEmail)) {
      setShowDeleteConfirm(null);
      return;
    }

    const newDeletedFor = [...currentDeletedFor, myEmail];

    const { error } = await (supabase as any)
      .from(table)
      .update({ deleted_for: newDeletedFor })
      .eq('id', messageId);

    if (error) {
      console.error(error);
      toast.error('No se pudo eliminar el mensaje');
      return;
    }

    toast.success('Mensaje eliminado (solo para vos)');
    setShowDeleteConfirm(null);

    if (selectedPeer) {
      if (isDMChannel) {
        loadDmMessages(selectedPeer, tab);
        loadChannelThreads(tab);
      } else if (tab === 'dm') {
        loadDmMessages(selectedPeer);
        loadDMThreads();
      }
    }
  };

  const sendChannelMessage = async (attachment?: Attachment) => {
    if (!text.trim() && !attachment) return;
    if (!myEmail) return;

    if (isPublicChannel) {
      const messageData: any = {
        sender_email: myEmail,
        sender_role: myRole,
        message_text: text.trim() || (attachment ? `📎 ${attachment.name}` : ''),
        attachment_url: attachment?.url || null,
        attachment_name: attachment?.name || null,
        attachment_type: attachment?.type || null,
        attachment_mime: attachment?.mime || null,
        channel_key: tab,
      };

      const { error, data } = await (supabase as any)
        .from('chat_messages')
        .insert(messageData)
        .select();

      if (error) {
        console.error('Error detallado:', error);
        toast.error(`No se pudo enviar: ${error.message || 'Error desconocido'}`);
        return;
      }

      if (data && data[0]) {
        const newMessage = data[0] as ChatMessage;
        setChannelMessages((prev) => [...prev, newMessage]);
        scrollBottom();
      }

      setText('');
      setShowEmojis(false);
      markChannelSeenLocal(tab);
      await loadUnreadCounts();
    } 
    else if (isDMChannel) {
      if (!selectedPeer) {
        toast.error('Debes seleccionar un destinatario');
        return;
      }

      if (!canSendToPeer(selectedPeer)) {
        toast.error('No tenés permiso para escribirle a este destinatario');
        return;
      }

      const key = threadKey(myEmail, selectedPeer);

      const messageData: any = {
        thread_key: key,
        from_email: myEmail,
        to_email: selectedPeer,
        from_role: myRole,
        topic_channel: tab,
        message_text: text.trim() || (attachment ? `📎 ${attachment.name}` : ''),
        attachment_url: attachment?.url || null,
        attachment_name: attachment?.name || null,
        attachment_type: attachment?.type || null,
        attachment_mime: attachment?.mime || null,
        read_at: null,
      };

      const { error, data } = await (supabase as any)
        .from('chat_dm_messages')
        .insert(messageData)
        .select();

      if (error) {
        console.error('Error detallado:', error);
        toast.error(`No se pudo enviar: ${error.message || 'Error desconocido'}`);
        return;
      }

      if (data && data[0]) {
        const newMessage = data[0] as ChatMessage;
        setDmMessages((prev) => [...prev, newMessage]);
        scrollBottom();
      }

      toast.success(`Mensaje enviado a ${contactMap[selectedPeer.toLowerCase()]?.name || selectedPeer}`);
      setText('');
      setShowEmojis(false);
      await loadChannelThreads(tab);
    }
  };

  const sendDm = async (attachment?: Attachment) => {
    if (!text.trim() && !attachment) return;
    if (!selectedPeer || !myEmail) return;

    if (!canSendToPeer(selectedPeer)) {
      toast.error('No tenés permiso para escribirle a este destinatario');
      return;
    }

    const key = threadKey(myEmail, selectedPeer);

    const messageData: any = {
      thread_key: key,
      from_email: myEmail,
      to_email: selectedPeer,
      from_role: myRole,
      topic_channel: 'dm',
      message_text: text.trim() || (attachment ? `📎 ${attachment.name}` : ''),
      attachment_url: attachment?.url || null,
      attachment_name: attachment?.name || null,
      attachment_type: attachment?.type || null,
      attachment_mime: attachment?.mime || null,
      read_at: null,
    };

    const { error, data } = await (supabase as any)
      .from('chat_dm_messages')
      .insert(messageData)
      .select();

    if (error) {
      console.error('Error detallado:', error);
      toast.error(`No se pudo enviar: ${error.message || 'Error desconocido'}`);
      return;
    }

    if (data && data[0]) {
      const newMessage = data[0] as ChatMessage;
      setDmMessages((prev) => [...prev, newMessage]);
      scrollBottom();
    }

    toast.success(`Mensaje enviado a ${contactMap[selectedPeer.toLowerCase()]?.name || selectedPeer}`);
    setText('');
    setShowEmojis(false);
    await loadDMThreads();
  };

  const send = () => {
    if (tab === 'dm') {
      sendDm();
    } else {
      sendChannelMessage();
    }
  };

  const handleFileInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const attachment = await handleFileUpload(file);
    if (!attachment) return;

    if (tab === 'dm') {
      await sendDm(attachment);
    } else {
      await sendChannelMessage(attachment);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file || tab === 'dm' || !activeChannel) return;

    if (!canEditChannelLogo) {
      toast.error('Solo ADMIN o PROVEEDOR aprobado puede cambiar el logo');
      return;
    }

    setUploading(true);

    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `channel-logos/${activeChannel.channel_key}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('chat-attachments')
        .upload(path, file, { upsert: true });

      if (uploadError) {
        console.error(uploadError);
        toast.error('No se pudo subir el logo');
        return;
      }

      const { data: urlData } = supabase.storage.from('chat-attachments').getPublicUrl(path);

      const { error: updateError } = await (supabase as any)
        .from('chat_channels')
        .update({
          logo_url: urlData.publicUrl,
          updated_by: profile?.user_id || null,
          updated_at: new Date().toISOString(),
        })
        .eq('channel_key', activeChannel.channel_key);

      if (updateError) {
        console.error(updateError);
        toast.error('No se pudo actualizar el logo del canal');
        return;
      }

      toast.success('Logo actualizado');
      loadChannels();
    } catch (error) {
      console.error(error);
      toast.error('Error actualizando logo');
    } finally {
      setUploading(false);

      if (logoInputRef.current) {
        logoInputRef.current.value = '';
      }
    }
  };

  const startRecording = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Tu navegador no permite grabar audio');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        setRecording(false);
        stream.getTracks().forEach((track) => track.stop());

        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `audio_${Date.now()}.webm`, {
          type: 'audio/webm',
        });

        const attachment = await handleFileUpload(file);
        if (!attachment) return;

        if (tab === 'dm') {
          await sendDm(attachment);
        } else {
          await sendChannelMessage(attachment);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      toast.success('Grabando audio...');
    } catch (error) {
      console.error(error);
      toast.error('No se pudo iniciar la grabación');
    }
  };

  const trackTyping = (value: string) => {
    setText(value);

    if (!myEmail || !typingChannelRef.current) return;

    typingChannelRef.current.track({
      email: myEmail,
      name: profile?.name || myEmail,
      typing: true,
    });

    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      typingChannelRef.current?.track({
        email: myEmail,
        name: profile?.name || myEmail,
        typing: false,
      });
    }, 1200);
  };

  const renderAttachment = (message: ChatMessage) => {
    if (!message.attachment_url) return null;

    const type = inferAttachmentType(message);

    if (type === 'video') {
      return (
        <div className="chat-attachment chat-attachment-video">
          <video 
            controls 
            src={message.attachment_url}
            className="chat-video-preview"
            controlsList="nodownload"
            preload="metadata"
          >
            Tu navegador no puede reproducir este video.
          </video>
        </div>
      );
    }

    if (type === 'image') {
      return (
        <div className="chat-attachment chat-attachment-image">
          <a
            href={message.attachment_url}
            target="_blank"
            rel="noreferrer"
            className="chat-attachment-image-link"
          >
            <img
              src={message.attachment_url}
              alt={message.attachment_name || 'Imagen enviada'}
              className="chat-image-preview"
            />
          </a>
        </div>
      );
    }

    if (type === 'audio') {
      return (
        <div className="chat-attachment chat-attachment-audio">
          <audio controls src={message.attachment_url} preload="metadata">
            Tu navegador no puede reproducir este audio.
          </audio>
        </div>
      );
    }

    return (
      <div className="chat-attachment">
        <a
          href={message.attachment_url}
          target="_blank"
          rel="noreferrer"
          className="chat-attachment-file"
        >
          📎 {message.attachment_name || 'Archivo adjunto'}
        </a>
      </div>
    );
  };

  const renderMessage = (message: ChatMessage) => {
    let senderEmail = '';
    let senderRole = '';
    
    if (isPublicChannel) {
      senderEmail = message.sender_email || '';
      senderRole = message.sender_role || '';
    } else {
      senderEmail = message.from_email || '';
      senderRole = message.from_role || '';
    }
    
    const mine = senderEmail?.toLowerCase() === myEmail.toLowerCase();
    const senderName = contactMap[senderEmail?.toLowerCase() || '']?.name || senderEmail?.split('@')[0] || 'Usuario';
    
    return (
      <div key={message.id} className={`chat-message-row ${mine ? 'mine' : 'theirs'}`}>
        <div className="chat-message-bubble">
          <div className="chat-message-meta">
            {senderRole && <span className="chat-role-badge">{senderRole}</span>}
            <strong>{senderName}</strong>
            {mine && (
              <button
                onClick={() => setShowDeleteConfirm(message.id)}
                className="chat-delete-btn"
                title="Eliminar mensaje (solo para vos)"
              >
                🗑️
              </button>
            )}
          </div>

          {message.message_text && <p className="chat-message-text">{message.message_text}</p>}

          {renderAttachment(message)}

          <div className="chat-message-footer">
            <span>{formatDateTime(message.created_at)}</span>
            {mine && (isDMChannel || tab === 'dm') && (
              <span className="chat-read-state">
                {message.read_at ? '✓✓ Leído' : '✓ Enviado'}
              </span>
            )}
          </div>
        </div>

        {showDeleteConfirm === message.id && (
          <div className="chat-delete-modal-overlay">
            <div className="chat-delete-modal">
              <p>¿Eliminar este mensaje?</p>
              <p className="chat-delete-modal-note">Se eliminará solo para vos. Los demás seguirán viéndolo.</p>
              <div className="chat-delete-modal-buttons">
                <button onClick={() => deleteMessage(message.id)} className="chat-delete-confirm">
                  Eliminar
                </button>
                <button onClick={() => setShowDeleteConfirm(null)} className="chat-delete-cancel">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ========== EFECTOS ==========

  // Detectar visibilidad de la pestaña
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsPageVisible(!document.hidden);
      if (!document.hidden) {
        // Restaurar título original cuando la pestaña se vuelve visible
        document.title = originalTitleRef.current;
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Pedir permiso para notificaciones del sistema
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        setNotificationPermission(permission === 'granted');
      });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      setNotificationPermission(true);
    }
  }, []);

  // Efecto inicial
  useEffect(() => {
    loadChannels();
    loadContacts();
  }, []);

  // Efecto para cargar datos según la pestaña
  useEffect(() => {
    if (!myEmail) return;

    if (tab === 'dm') {
      loadDMThreads();
      if (selectedPeer) {
        loadDmMessages(selectedPeer);
      }
    } else if (isPublicChannel) {
      loadChannelMessages(tab);
      markChannelSeenLocal(tab);
      loadUnreadCounts();
    } else if (isDMChannel) {
      loadChannelThreads(tab);
      if (selectedPeer) {
        loadDmMessages(selectedPeer, tab);
      }
    }
  }, [myEmail, tab, selectedPeer, channels.length]);

  // Efecto para recargar mensajes cuando cambia selectedPeer
  useEffect(() => {
    if (selectedPeer) {
      if (isDMChannel) {
        loadDmMessages(selectedPeer, tab);
      } else if (tab === 'dm') {
        loadDmMessages(selectedPeer);
      }
    }
  }, [selectedPeer, tab]);

  // Suscripción en tiempo real con NOTIFICACIONES
  useEffect(() => {
    if (!myEmail) return;

    const channelSubscription = supabase
      .channel('chat-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
        },
        (payload) => {
          const newMessage = payload.new as ChatMessage;
          if (isPublicChannel && newMessage.channel_key === tab) {
            setChannelMessages((prev) => {
              const exists = prev.some(msg => msg.id === newMessage.id);
              if (exists) return prev;
              return [...prev, newMessage];
            });
            scrollBottom();
            
            if (newMessage.sender_email !== myEmail) {
              loadUnreadCounts();
            }
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_dm_messages',
        },
        (payload) => {
          const newMessage = payload.new as ChatMessage;
          
          const msgTopic = newMessage.topic_channel || 'dm';
          
          // Verificar si el mensaje me concierne
          const concernsMe = newMessage.to_email === myEmail || 
                            newMessage.from_email === myEmail || 
                            isAdminOrDespachante ||
                            (isProvider && (newMessage.to_email === myEmail || newMessage.from_email === myEmail));
          
          if (concernsMe) {
            // 🔔 MOSTRAR NOTIFICACIÓN si no fui yo quien envió el mensaje
            if (newMessage.from_email !== myEmail && notificationsEnabled) {
              const senderName = contactMap[newMessage.from_email?.toLowerCase() || '']?.name || newMessage.from_email || 'Alguien';
              const messagePreview = newMessage.message_text || (newMessage.attachment_url ? '📎 Archivo adjunto' : 'Mensaje');
              
              showNotification(senderName, newMessage.from_email || '', messagePreview || '', msgTopic);
            }
            
            if (tab === msgTopic || (tab === 'dm' && msgTopic === 'dm')) {
              let shouldUpdate = false;
              
              if ((isAdminOrDespachante || isProvider) && selectedPeer) {
                if (selectedPeer.includes('|')) {
                  const [email1, email2] = selectedPeer.split('|');
                  shouldUpdate = (newMessage.from_email === email1 || newMessage.from_email === email2);
                } else {
                  shouldUpdate = (newMessage.from_email === selectedPeer || newMessage.to_email === selectedPeer);
                }
              } else if (selectedPeer) {
                shouldUpdate = (newMessage.from_email === selectedPeer || newMessage.to_email === selectedPeer);
              }
              
              if (shouldUpdate || !selectedPeer) {
                setDmMessages((prev) => {
                  const exists = prev.some(msg => msg.id === newMessage.id);
                  if (exists) return prev;
                  return [...prev, newMessage];
                });
                scrollBottom();
              }
              
              if (msgTopic !== 'dm') {
                loadChannelThreads(tab);
              } else {
                loadDMThreads();
              }
            }

            // Marcar como leído inmediatamente si es para mí y estoy viendo la conversación
            if (newMessage.to_email === myEmail && !newMessage.read_at) {
              const isCurrentChat = selectedPeer === newMessage.from_email && tab === msgTopic;
              if (isCurrentChat && isPageVisible) {
                (supabase as any)
                  .from('chat_dm_messages')
                  .update({ read_at: new Date().toISOString() })
                  .eq('id', newMessage.id);
              }
            }
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channelSubscription);
    };
  }, [myEmail, tab, selectedPeer, isPublicChannel, isAdminOrDespachante, isProvider, notificationsEnabled, isPageVisible]);

  // Typing presence
  useEffect(() => {
    if (!myEmail) return;

    const typingChannelName = isDMChannel && selectedPeer
      ? `typing-${tab}-${threadKey(myEmail, selectedPeer)}`
      : `typing-${tab}`;

    const typingChannel = supabase.channel(typingChannelName, {
      config: {
        presence: {
          key: myEmail,
        },
      },
    });

    typingChannelRef.current = typingChannel;

    typingChannel
      .on('presence', { event: 'sync' }, () => {
        const state = typingChannel.presenceState();

        const users = Object.values(state)
          .flat()
          .filter((item: any) => item.email !== myEmail && item.typing)
          .map((item: any) => item.name || item.email);

        setTypingUsers([...new Set(users)] as string[]);
      })
      .subscribe();

    return () => {
      typingChannel.track({
        email: myEmail,
        name: profile?.name || myEmail,
        typing: false,
      });

      typingChannelRef.current = null;
      setTypingUsers([]);
      supabase.removeChannel(typingChannel);
    };
  }, [myEmail, tab, selectedPeer, isDMChannel]);

  if (loadingContacts) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
          <p className="text-slate-400">Cargando chat...</p>
        </div>
      </div>
    );
  }

  // Componente de burbuja de notificación
  const NotificationBubble = () => {
    if (!notification) return null;
    
    return (
      <div 
        className="fixed bottom-5 right-5 z-50 animate-in slide-in-from-right duration-300 cursor-pointer"
        onClick={() => handleNotificationClick(notification)}
      >
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl shadow-2xl p-3 max-w-sm border border-blue-400/30 hover:scale-105 transition-transform">
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-blue-400/20 flex items-center justify-center text-xl">
                💬
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white truncate">
                  {notification.from}
                </p>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setNotification(null);
                  }}
                  className="text-white/50 hover:text-white text-xs ml-2 transition-colors"
                >
                  ✕
                </button>
              </div>
              <p className="text-xs text-blue-100 mt-0.5 truncate">
                {notification.message}
              </p>
              <p className="text-[10px] text-blue-200/70 mt-1 flex items-center gap-1">
                <span>🔔</span> Haz clic para ver
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <NotificationBubble />
      
      <div className="chat-view">
        <div className="chat-header">
          <h2>Chat</h2>
          {/* Campanita para activar/desactivar notificaciones */}
          <button
            onClick={toggleNotifications}
            className={`chat-notification-toggle ${notificationsEnabled ? 'active' : 'inactive'}`}
            title={notificationsEnabled ? 'Desactivar notificaciones' : 'Activar notificaciones'}
          >
            {notificationsEnabled ? '🔔' : '🔕'}
          </button>
        </div>

        <div className="chat-tabs">
          {channels.map((channel) => (
            <button
              key={channel.channel_key}
              type="button"
              onClick={() => {
                setTab(channel.channel_key);
                setSelectedPeer('');
              }}
              className={`chat-tab ${tab === channel.channel_key ? 'active' : ''}`}
            >
              <span className="chat-tab-avatar">
                {channel.logo_url ? (
                  <img src={channel.logo_url} alt={channel.title} className="w-6 h-6 rounded-full object-cover" />
                ) : (
                  <span>💬</span>
                )}
              </span>

              <span className="chat-tab-title">{channel.title}</span>

              {PUBLIC_CHANNELS.includes(channel.channel_key) && !!unreadByChannel[channel.channel_key] && (
                <span className="chat-unread-badge">
                  {unreadByChannel[channel.channel_key]}
                </span>
              )}
            </button>
          ))}

          <button
            type="button"
            onClick={() => {
              setTab('dm');
              setSelectedPeer('');
            }}
            className={`chat-tab ${tab === 'dm' ? 'active' : ''}`}
          >
            <span className="chat-tab-avatar">📩</span>
            <span className="chat-tab-title">Mensajes Directos</span>
          </button>
        </div>

        {/* Resto del contenido igual... */}
        <div className="chat-layout">
          <aside className="chat-sidebar">
            {!isPublicChannel && tab !== 'dm' && (
              <div className="chat-dm-selector">
                <label className="chat-label">✏️ Escribir a</label>
                <select
                  value={selectedPeer}
                  onChange={(event) => selectPeer(event.target.value, tab)}
                  className="chat-select"
                >
                  <option value="">-- Elegir destinatario --</option>
                  {availableContacts.map((contact) => (
                    <option key={contact.email} value={contact.email}>
                      {contact.role ? `${contact.role} · ` : ''}
                      {contact.name || contact.email}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {tab === 'dm' && (
              <>
                <div className="chat-dm-selector">
                  <label className="chat-label">✏️ Escribir a</label>
                  <select
                    value={selectedPeer}
                    onChange={(event) => selectPeer(event.target.value, 'dm')}
                    className="chat-select"
                  >
                    <option value="">-- Elegir destinatario --</option>
                    {availableContacts.map((contact) => (
                      <option key={contact.email} value={contact.email}>
                        {contact.role ? `${contact.role} · ` : ''}
                        {contact.name || contact.email}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="chat-sidebar-header">
                  <strong>📋 Conversaciones</strong>
                  <button type="button" onClick={loadDMThreads} title="Actualizar">
                    ↻
                  </button>
                </div>

                <div className="chat-thread-list">
                  {threads.map((thread) => (
                    <button
                      key={thread.key}
                      type="button"
                      onClick={() => selectPeer(thread.peer, 'dm')}
                      className={`chat-thread ${selectedPeer === thread.peer ? 'active' : ''}`}
                    >
                      <div className="chat-thread-top">
                        <strong>{thread.peerName}</strong>
                        <span>{formatTime(thread.lastTime)}</span>
                      </div>
                      <div className="chat-thread-bottom">
                        <span className="chat-thread-message">{thread.lastMsg}</span>
                        {!!thread.unread && (
                          <span className="chat-unread-badge">{thread.unread}</span>
                        )}
                      </div>
                    </button>
                  ))}

                  {threads.length === 0 && (
                    <p className="chat-empty-small">Sin conversaciones aún</p>
                  )}
                </div>
              </>
            )}

            {isDMChannel && (
              <>
                <div className="chat-sidebar-header">
                  <strong>📋 Conversaciones en {activeChannel?.title}</strong>
                  <button 
                    type="button" 
                    onClick={async () => {
                      await loadChannelThreads(tab);
                      if (selectedPeer) {
                        await loadDmMessages(selectedPeer, tab);
                      }
                    }} 
                    title="Actualizar"
                  >
                    ↻
                  </button>
                </div>

                <div className="chat-thread-list">
                  {channelThreads.map((thread) => (
                    <button
                      key={thread.key}
                      type="button"
                      onClick={async () => {
                        setSelectedPeer(thread.peer);
                        await loadDmMessages(thread.peer, tab);
                      }}
                      className={`chat-thread ${selectedPeer === thread.peer ? 'active' : ''}`}
                    >
                      <div className="chat-thread-top">
                        <strong>{thread.peerName}</strong>
                        <span>{formatTime(thread.lastTime)}</span>
                      </div>
                      <div className="chat-thread-bottom">
                        <span className="chat-thread-message">{thread.lastMsg}</span>
                        {!!thread.unread && (
                          <span className="chat-unread-badge">{thread.unread}</span>
                        )}
                      </div>
                    </button>
                  ))}

                  {channelThreads.length === 0 && (
                    <p className="chat-empty-small">
                      No hay conversaciones aún. Selecciona un destinatario arriba para comenzar.
                    </p>
                  )}
                </div>
              </>
            )}

            {isPublicChannel && (
              <>
                <div className="chat-sidebar-header">
                  <strong>ℹ️ Información</strong>
                </div>

                <div className="chat-channel-profile">
                  <div className="chat-channel-logo">
                    {activeChannel?.logo_url ? (
                      <img src={activeChannel.logo_url} alt={activeChannel.title} className="w-12 h-12 rounded-full object-cover" />
                    ) : (
                      <span className="text-2xl">💬</span>
                    )}

                    {canEditChannelLogo && (
                      <button
                        type="button"
                        className="chat-logo-edit"
                        onClick={() => logoInputRef.current?.click()}
                        title="Cambiar logo de esta pestaña"
                        disabled={uploading}
                      >
                        📷
                      </button>
                    )}
                  </div>

                  <div>
                    <span className="chat-current-label">Canal activo</span>
                    <strong>{activeChannel?.title}</strong>
                    <p className="chat-channel-description">
                      {activeChannel?.channel_key === 'general' 
                        ? '💬 Todos los usuarios pueden ver y escribir aquí' 
                        : '📸 Todos los usuarios pueden ver y compartir fotos de productos aquí'}
                    </p>
                  </div>
                </div>

                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={handleLogoUpload}
                />
              </>
            )}
          </aside>

          <section className="chat-main">
            <div className="chat-current-header">
              {tab === 'dm' ? (
                <>
                  <span className="chat-current-label">💬 Chat con</span>
                  <div className="chat-current-title">
                    <strong>
                      {selectedPeer
                        ? isAdminOrDespachante && selectedPeer.includes('|')
                          ? selectedPeer.split('|').map(email => contactMap[email.toLowerCase()]?.name || email).join(' ↔ ')
                          : contactMap[selectedPeer.toLowerCase()]?.name || selectedPeer
                        : 'Seleccione un destinatario'}
                    </strong>
                    {selectedPeer && !selectedPeer.includes('|') && contactMap[selectedPeer.toLowerCase()]?.role && (
                      <span className="chat-role">{contactMap[selectedPeer.toLowerCase()].role}</span>
                    )}
                  </div>
                </>
              ) : isPublicChannel ? (
                <div className="chat-current-title">
                  <span className="chat-current-label">📢 Chat público</span>
                  <strong>{activeChannel?.title}</strong>
                </div>
              ) : (
                <div className="chat-current-title">
                  <span className="chat-current-label">📌 {activeChannel?.title} - Conversación con</span>
                  <strong>
                    {selectedPeer
                      ? isAdminOrDespachante && selectedPeer.includes('|')
                        ? selectedPeer.split('|').map(email => contactMap[email.toLowerCase()]?.name || email).join(' ↔ ')
                        : contactMap[selectedPeer.toLowerCase()]?.name || selectedPeer
                      : 'Seleccione un destinatario'}
                  </strong>
                  {selectedPeer && !selectedPeer.includes('|') && contactMap[selectedPeer.toLowerCase()]?.role && (
                    <span className="chat-role">{contactMap[selectedPeer.toLowerCase()].role}</span>
                  )}
                </div>
              )}
            </div>

            <div ref={msgRef} className="chat-messages">
              {isPublicChannel && messages.length === 0 && (
                <div className="chat-empty">✨ Sin mensajes aún. ¡Escribí el primero!</div>
              )}

              {isPublicChannel && messages.length > 0 && (
                <div className="chat-messages-list">
                  {messages.map(renderMessage)}
                </div>
              )}

              {isDMChannel && !selectedPeer && (
                <div className="chat-empty">
                  👋 Selecciona un destinatario arriba para comenzar a conversar
                </div>
              )}

              {isDMChannel && selectedPeer && dmMessages.length === 0 && (
                <div className="chat-empty">
                  💬 Sin mensajes aún con {selectedPeer.includes('|') 
                    ? selectedPeer.split('|').map(email => contactMap[email.toLowerCase()]?.name || email).join(' y ')
                    : contactMap[selectedPeer.toLowerCase()]?.name || selectedPeer}. ¡Envía tu primer mensaje!
                </div>
              )}

              {isDMChannel && selectedPeer && dmMessages.length > 0 && (
                <div className="chat-messages-list">
                  {dmMessages.map(renderMessage)}
                </div>
              )}

              {tab === 'dm' && !selectedPeer && (
                <div className="chat-empty">
                  👋 Selecciona un destinatario o una conversación existente
                </div>
              )}

              {tab === 'dm' && selectedPeer && dmMessages.length === 0 && (
                <div className="chat-empty">
                  💬 Sin mensajes aún con {selectedPeer.includes('|')
                    ? selectedPeer.split('|').map(email => contactMap[email.toLowerCase()]?.name || email).join(' y ')
                    : contactMap[selectedPeer.toLowerCase()]?.name || selectedPeer}
                </div>
              )}

              {tab === 'dm' && selectedPeer && dmMessages.length > 0 && (
                <div className="chat-messages-list">
                  {dmMessages.map(renderMessage)}
                </div>
              )}

              {typingUsers.length > 0 && (
                <div className="chat-typing">
                  {typingUsers.join(', ')} está escribiendo...
                </div>
              )}
            </div>

            <div className="chat-composer">
              <input ref={fileInputRef} type="file" hidden onChange={handleFileInput} accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt" />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Adjuntar archivo (imagen, video, audio)"
                className="chat-icon-button"
              >
                {uploading ? '⏳' : '📎'}
              </button>

              <button
                type="button"
                onClick={startRecording}
                disabled={uploading}
                title={recording ? 'Detener audio' : 'Grabar audio'}
                className={`chat-icon-button ${recording ? 'recording' : ''}`}
              >
                {recording ? '⏹️' : '🎙️'}
              </button>

              <div className="chat-emoji-wrap">
                <button
                  type="button"
                  onClick={() => setShowEmojis((value) => !value)}
                  title="Emojis"
                  className="chat-icon-button"
                >
                  😊
                </button>

                {showEmojis && (
                  <div className="chat-emoji-panel">
                    {EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => setText((prev) => `${prev}${emoji}`)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <input
                value={text}
                placeholder={
                  isPublicChannel 
                    ? "✏️ Escribí tu mensaje público..." 
                    : (!selectedPeer && (isDMChannel || tab === 'dm')
                        ? "🔒 Selecciona un destinatario primero"
                        : "✏️ Escribí tu mensaje...")
                }
                onChange={(event) => trackTyping(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    send();
                  }
                }}
                disabled={(isDMChannel || tab === 'dm') && !selectedPeer}
                className="chat-input"
              />

              <button
                type="button"
                onClick={send}
                disabled={
                  uploading || 
                  recording || 
                  !text.trim() || 
                  ((isDMChannel || tab === 'dm') && !selectedPeer)
                }
                className="chat-send-button"
              >
                Enviar
              </button>
            </div>
          </section>
        </div>
      </div>

      <style>{`
        .chat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }
        
        .chat-notification-toggle {
          background: none;
          border: none;
          font-size: 1.25rem;
          cursor: pointer;
          padding: 0.5rem;
          border-radius: 9999px;
          transition: all 0.2s;
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .chat-notification-toggle.active {
          background: rgba(59, 130, 246, 0.2);
          color: #3b82f6;
        }
        
        .chat-notification-toggle.inactive {
          background: rgba(100, 116, 139, 0.2);
          color: #64748b;
        }
        
        .chat-notification-toggle:hover {
          transform: scale(1.05);
        }
        
        @keyframes slide-in-right {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        
        .animate-in {
          animation: slide-in-right 0.3s ease-out;
        }
        
        .slide-in-from-right {
          animation: slide-in-right 0.3s ease-out;
        }
      `}</style>
    </>
  );
}
