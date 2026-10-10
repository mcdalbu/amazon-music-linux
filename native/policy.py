"""Shared settings and navigation policy for the native Electron client."""
from urllib.parse import urlsplit
import re
REGIONS = {
    'BR': ('Brasil', 'https://music.amazon.com.br/'),
    'US': ('Estados Unidos', 'https://music.amazon.com/'),
    'DE': ('Alemanha', 'https://music.amazon.de/'),
    'UK': ('Reino Unido', 'https://music.amazon.co.uk/'),
    'FR': ('França', 'https://music.amazon.fr/'),
    'ES': ('Espanha', 'https://music.amazon.es/'),
    'IT': ('Itália', 'https://music.amazon.it/'),
    'JP': ('Japão', 'https://music.amazon.co.jp/'),
}
DOMAINS = ('amazon.com.br', 'amazon.com', 'amazon.de', 'amazon.co.uk',
           'amazon.fr', 'amazon.es', 'amazon.it', 'amazon.co.jp')
def https_url(raw):
    try:
        url = urlsplit(raw)
        return url if (url.scheme == 'https' and url.hostname and not url.username
                       and not url.password and url.port in (None, 443)) else None
    except (ValueError, TypeError):
        return None

def amazon_url(raw):
    url = https_url(raw)
    return bool(url and any(url.hostname == d or url.hostname.endswith('.' + d) for d in DOMAINS))

def music_url(raw):
    url = https_url(raw)
    return bool(url and url.hostname in [urlsplit(v[1]).hostname for v in REGIONS.values()])

def clean_settings(value):
    if not isinstance(value, dict): value = {}
    return {'region': value.get('region') if value.get('region') in REGIONS else 'BR',
            'theme': value.get('theme') if value.get('theme') in ('system', 'light', 'dark') else 'system',
            'hardwareAcceleration': value.get('hardwareAcceleration') is True,
            'mute': value.get('mute') is True,
            'background': value.get('background') is True}

def clean_media(value):
    if not isinstance(value, dict) or not all(type(value.get(k)) is bool for k in ('available', 'paused')):
        return None
    return dict(available=value['available'], paused=value['paused'],
                artwork=artwork_url(value.get('artwork')),canNext=value.get('canNext') is True,
                canPrevious=value.get('canPrevious') is True,
                **{key: value.get(key, '')[:256] if isinstance(value.get(key, ''), str) else ''
                   for key in ('title', 'artist', 'album')})

def artwork_url(raw):
    if not isinstance(raw,str) or len(raw)>4096:return ''
    if re.fullmatch(r'data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+',raw):return raw
    url=https_url(raw)
    domains=('media-amazon.com','ssl-images-amazon.com',*DOMAINS)
    return raw if url and any(url.hostname==d or url.hostname.endswith('.'+d) for d in domains) else ''
