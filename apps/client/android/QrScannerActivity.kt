package work.itzme.ploom

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.Gravity
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.zxing.*
import com.google.zxing.common.HybridBinarizer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class QrScannerActivity : ComponentActivity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val finished = AtomicBoolean()
    private var camera: Camera? = null
    private var provider: ProcessCameraProvider? = null
    private lateinit var preview: PreviewView
    private lateinit var torch: Button
    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        if (it) startCamera() else finish()
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val ru = java.util.Locale.getDefault().language == "ru"
        val frame = FrameLayout(this)
        preview = PreviewView(this)
        frame.addView(preview)
        val border = android.view.View(this)
        border.background = android.graphics.drawable.GradientDrawable().apply {
            setColor(android.graphics.Color.TRANSPARENT)
            setStroke((2 * resources.displayMetrics.density).toInt(),android.graphics.Color.WHITE)
        }
        val side = (0.65 * minOf(resources.displayMetrics.widthPixels,resources.displayMetrics.heightPixels)).toInt()
        frame.addView(border,FrameLayout.LayoutParams(side,side,Gravity.CENTER))
        val controls = LinearLayout(this).apply { gravity=Gravity.CENTER }
        torch = Button(this).apply {
            text = if (ru) "Фонарик" else "Torch"
            isEnabled=false
            setOnClickListener { camera?.let { it.cameraControl.enableTorch(it.cameraInfo.torchState.value != TorchState.ON) } }
        }
        controls.addView(torch)
        controls.addView(Button(this).apply { text=if(ru)"Отмена" else "Cancel";setOnClickListener{finish()} })
        frame.addView(controls,FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM))
        setContentView(frame)
        preview.setOnTouchListener { _, event ->
            if(event.action==android.view.MotionEvent.ACTION_UP){
                val point=preview.meteringPointFactory.createPoint(event.x,event.y)
                camera?.cameraControl?.startFocusAndMetering(FocusMeteringAction.Builder(point).build())
                preview.performClick()
            }
            true
        }
        if(checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED) startCamera()
        else permission.launch(Manifest.permission.CAMERA)
    }
    private fun startCamera(){
        val future=ProcessCameraProvider.getInstance(this)
        future.addListener({
            if(isFinishing || isDestroyed)return@addListener
            try {
                val current=future.get()
                provider=current
                val view=Preview.Builder().build().also{it.setSurfaceProvider(preview.surfaceProvider)}
                val analysis=ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                val reader=com.google.zxing.qrcode.QRCodeReader()
                analysis.setAnalyzer(worker) { image ->
                    try {
                        if (finished.get()) return@setAnalyzer
                        val plane=image.planes[0]
                        val w=image.width;val h=image.height
                        val pixels=ByteArray(w*h)
                        val buffer=plane.buffer.duplicate()
                        for(y in 0 until h){
                            buffer.position(y*plane.rowStride)
                            if(plane.pixelStride==1) buffer.get(pixels,y*w,w)
                            else for(x in 0 until w)pixels[y*w+x]=buffer.get(y*plane.rowStride+x*plane.pixelStride)
                        }
                        val source=PlanarYUVLuminanceSource(pixels,w,h,0,0,w,h,false)
                        val text=reader.decode(BinaryBitmap(HybridBinarizer(source))).text
                        if(text.isNotBlank() && text.length<=65536 && finished.compareAndSet(false,true)){
                            runOnUiThread {setResult(Activity.RESULT_OK,Intent().putExtra("qr",text));finish()}
                        }
                    } catch (_:ReaderException) {
                        // Try the next frame.
                    } finally {reader.reset();image.close()}
                }
                camera=current.bindToLifecycle(this,CameraSelector.DEFAULT_BACK_CAMERA,view,analysis)
                torch.isEnabled=camera?.cameraInfo?.hasFlashUnit()==true
            } catch(_:Exception){ finish() }
        },ContextCompat.getMainExecutor(this))
    }
    override fun onDestroy(){finished.set(true);provider?.unbindAll();worker.shutdown();super.onDestroy()}
}
