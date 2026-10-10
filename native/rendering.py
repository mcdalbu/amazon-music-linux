"""Translate GDK display timing to Electron's integer offscreen frame rate."""
import math

def configure_renderer(environment,gpu,dmabuf):
    if 'GSK_RENDERER' in environment:return False
    environment['GSK_RENDERER']='vulkan' if gpu and dmabuf else 'gl'
    return True

def frame_rate(millihertz=0, interval_usec=0):
    if isinstance(millihertz,(int,float)) and math.isfinite(millihertz) and millihertz>0:
        rate=millihertz/1000
    elif isinstance(interval_usec,(int,float)) and math.isfinite(interval_usec) and interval_usec>0:
        rate=1_000_000/interval_usec
    else:
        rate=60  # Bootstrap only, until the monitor or frame clock is known.
    return min(240,max(1,math.floor(rate+0.5)))
