"""Only completed CastLabs registration and a successful EME probe establish DRM state."""
WIDEVINE_ID='widevine'

def drm_state(component, eme_ready, startup_versions=()):
    if eme_ready: return 'ready'
    if not component: return 'unavailable'
    version=component.get('version','')
    status=component.get('status')
    if status=='updated' and version and version!='0.0.0.0' and version not in startup_versions:
        return 'restart'
    if status=='preparing': return 'preparing'
    return 'unavailable'
