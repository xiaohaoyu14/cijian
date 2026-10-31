import java.lang.reflect.Method;
import kotlin.jvm.functions.Function1;

/** Reproduces the exact GetMethodID lookup used in the pinned Android JNI. */
public class PiperCallbackContract {
    public static void main(String[] args) throws Exception {
        Function1<float[], Integer> oldCallback = samples -> 1;
        Method erased = oldCallback.getClass().getDeclaredMethod("invoke", Object.class);
        if(erased.getReturnType()!=Object.class)throw new AssertionError(erased);
        try {
            Method typed = oldCallback.getClass().getDeclaredMethod("invoke", float[].class);
            throw new AssertionError("Expected old Java lambda to lack JNI signature: " + typed);
        } catch(NoSuchMethodException expected) {
            System.out.println("REPRODUCED: old Java lambda lacks invoke(float[]):Integer required by pinned JNI");
        }
    }
}
